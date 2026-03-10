#!/usr/bin/env python3
"""
Whisper Server — Local FastAPI service for audio transcription & text-audio alignment.
Uses faster-whisper with large-v3-turbo model.

Usage:
    pip install -r requirements.txt
    python main.py

Endpoints:
    GET  /status      — Check if model is loaded
    POST /transcribe  — Transcribe audio (returns segments with text + timestamps)
    POST /align       — Align user-provided text to audio using Whisper timestamps
"""

import os
import io
import tempfile
import logging
from typing import Optional
from difflib import SequenceMatcher

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# ─── Config ───────────────────────────────────────────────────────
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")  # "cpu", "cuda", or "auto"
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "auto")  # "int8", "float16", "auto"
HOST = os.environ.get("WHISPER_HOST", "0.0.0.0")
PORT = int(os.environ.get("WHISPER_PORT", "8000"))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("whisper-server")

# ─── App ──────────────────────────────────────────────────────────
app = FastAPI(title="SvenskaDictate Whisper Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Model Loading ────────────────────────────────────────────────
model: Optional[WhisperModel] = None
model_loading = False
model_error: Optional[str] = None


def load_model():
    """Load the Whisper model (called at startup)."""
    global model, model_loading, model_error
    model_loading = True
    log.info(f"Loading model '{MODEL_SIZE}' on device='{DEVICE}', compute='{COMPUTE_TYPE}'...")
    try:
        model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("✅ Model loaded successfully!")
    except Exception as e:
        model_error = str(e)
        log.error(f"❌ Failed to load model: {e}")
    finally:
        model_loading = False


# ─── Endpoints ────────────────────────────────────────────────────

@app.get("/status")
def status():
    """Check if the server and model are ready."""
    return {
        "ready": model is not None,
        "loading": model_loading,
        "model": MODEL_SIZE,
        "error": model_error,
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("sv"),
):
    """
    Transcribe audio file → segments with text + timestamps.
    Used when user imports audio only (no text file).
    """
    if model is None:
        raise HTTPException(503, "Model not loaded yet")

    # Save uploaded file to temp
    audio_bytes = await audio.read()
    with tempfile.NamedTemporaryFile(suffix=_get_ext(audio.filename), delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        segments_raw, info = model.transcribe(
            tmp_path,
            language=language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
            ),
        )

        segments = []
        for i, seg in enumerate(segments_raw):
            segments.append({
                "index": i,
                "startTime": round(seg.start, 2),
                "endTime": round(seg.end, 2),
                "text": seg.text.strip(),
                "words": [
                    {"word": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)}
                    for w in (seg.words or [])
                ],
            })

        # Apply padding to prevent abrupt cutoffs
        segments = _pad_segment_boundaries(segments, info.duration)

        log.info(f"Transcribed {len(segments)} segments, language={info.language} (prob={info.language_probability:.2f})")
        return {
            "segments": segments,
            "language": info.language,
            "languageProbability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
        }
    finally:
        os.unlink(tmp_path)


@app.post("/align")
async def align(
    audio: UploadFile = File(...),
    text: UploadFile = File(...),
    language: str = Form("sv"),
):
    """
    Align user-provided text to audio using Whisper's natural segmentation.
    
    NEW Algorithm (v2):
    1. Whisper transcribes audio → natural sentence-level segments (with timestamps)
    2. User's text is split into sentences
    3. Match user sentences to Whisper segments using text similarity
    4. Result: Whisper's timestamps + user's exact text
    
    This is much better than the old approach of distributing words proportionally.
    """
    if model is None:
        raise HTTPException(503, "Model not loaded yet")

    # Read files
    audio_bytes = await audio.read()
    text_content = (await text.read()).decode("utf-8")

    # Save audio to temp
    with tempfile.NamedTemporaryFile(suffix=_get_ext(audio.filename), delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        # Step 1: Run Whisper with natural sentence segmentation
        # We purposely DO NOT use initial_prompt here, because passing the user text
        # forces Whisper to mimic the user text's potentially flawed sentence pacing,
        # which destroys Whisper's natural acoustic sentence boundaries.
        segments_raw, info = model.transcribe(
            tmp_path,
            language=language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
            ),
        )

        # Collect Whisper's natural segments
        whisper_segments = []
        for seg in segments_raw:
            whisper_segments.append({
                "text": seg.text.strip(),
                "start": seg.start,
                "end": seg.end,
                "words": [
                    {"word": w.word.strip(), "start": w.start, "end": w.end}
                    for w in (seg.words or [])
                ],
            })

        if not whisper_segments:
            raise HTTPException(400, "No speech detected in audio")

        # Step 2: Split user's text into sentences
        user_sentences = _split_sentences(text_content)
        if not user_sentences:
            raise HTTPException(400, "No sentences found in text file")

        log.info(f"Whisper found {len(whisper_segments)} segments, user has {len(user_sentences)} sentences")

        # Step 3: Match user sentences to Whisper segments
        aligned = _match_user_text_to_whisper_segments(user_sentences, whisper_segments)

        # Apply padding to prevent abrupt cutoffs
        aligned = _pad_segment_boundaries(aligned, info.duration)

        log.info(f"Aligned {len(aligned)} segments")
        return {
            "segments": aligned,
            "language": info.language,
            "languageProbability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "whisperSegmentCount": len(whisper_segments),
            "userSentenceCount": len(user_sentences),
        }
    finally:
        os.unlink(tmp_path)


# ─── Helpers ──────────────────────────────────────────────────────

def _pad_segment_boundaries(segments: list[dict], duration: float, pad_start=0.15, pad_end=0.25) -> list[dict]:
    """
    Pad start and end times by a small amount to prevent abrupt audio cutoffs.
    Does not let padding extend past the audio boundaries (0 to duration).
    And avoids heavy overlap with adjacent segments.
    """
    for i, seg in enumerate(segments):
        start = seg["startTime"]
        end = seg["endTime"]
        
        # Calculate available silence before segment
        prev_end = segments[i-1]["endTime"] if i > 0 else 0.0
        available_before = start - prev_end
        
        # Calculate available silence after segment
        next_start = segments[i+1]["startTime"] if i < len(segments) - 1 else duration
        available_after = next_start - end
        
        # Pad by desired amount, clamped to available silence (allow a tiny overlap max 0.05s if necessary)
        actual_pad_start = min(pad_start, max(available_before / 2, 0.05)) if available_before > 0 else 0.0
        actual_pad_end = min(pad_end, max(available_after / 2, 0.05)) if available_after > 0 else 0.0
        
        # Fast speech might have negative available silence (already overlapping), don't pad further inwards
        if available_before <= 0: actual_pad_start = 0.0
        if available_after <= 0: actual_pad_end = 0.0
        
        seg["startTime"] = round(max(0.0, start - actual_pad_start), 2)
        seg["endTime"] = round(min(duration, end + actual_pad_end), 2)
        
    return segments


def _get_ext(filename: Optional[str]) -> str:
    """Get file extension for temp file."""
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[-1]
    return ".wav"


def _split_sentences(text: str) -> list[str]:
    """
    Split text into sentences. Handles:
    - Line breaks
    - Swedish abbreviations (t.ex., bl.a., etc.)
    - Multiple punctuation types
    """
    import re

    # Protect common Swedish abbreviations
    protected = text
    abbrevs = ["t.ex.", "bl.a.", "m.m.", "d.v.s.", "o.s.v.", "s.k.", "f.d.", "p.g.a.", "m.fl."]
    for i, abbr in enumerate(abbrevs):
        protected = protected.replace(abbr, f"__ABBR{i}__")

    # Split by newlines first
    lines = [line.strip() for line in protected.split("\n") if line.strip()]
    
    result = []
    for line in lines:
        # Split on sentence-ending punctuation
        parts = re.split(r'(?<=[.!?])\s+', line)
        
        for part in parts:
            # Restore abbreviations
            str_part = part
            for i, abbr in enumerate(abbrevs):
                str_part = str_part.replace(f"__ABBR{i}__", abbr)
            str_part = str_part.strip()
            if str_part:
                result.append(str_part)
                
    return result


def _match_user_text_to_whisper_segments(
    user_sentences: list[str],
    whisper_segments: list[dict],
) -> list[dict]:
    """
    Match user's sentences to Whisper's natural segments.
    
    Strategy:
    - If user has N sentences and Whisper has M segments:
      - If N == M: direct 1:1 mapping (user text + Whisper timestamps)
      - If N < M:  merge consecutive Whisper segments to match user sentence count
      - If N > M:  use Whisper's word-level timestamps to sub-divide segments
    
    In all cases, we keep Whisper's timestamps and use user's text.
    """
    N = len(user_sentences)
    M = len(whisper_segments)

    if N == M:
        # Perfect match: 1:1
        return [
            {
                "index": i,
                "startTime": round(ws["start"], 2),
                "endTime": round(ws["end"], 2),
                "text": user_sentences[i],
            }
            for i, ws in enumerate(whisper_segments)
        ]

    if N <= M:
        # More Whisper segments than user sentences
        # → Merge Whisper segments greedily by matching text similarity
        return _merge_whisper_to_match_user(user_sentences, whisper_segments)

    # N > M: More user sentences than Whisper segments
    # → Use word-level timestamps to sub-divide Whisper segments
    return _subdivide_whisper_for_user(user_sentences, whisper_segments)


def _merge_whisper_to_match_user(
    user_sentences: list[str],
    whisper_segments: list[dict],
) -> list[dict]:
    """
    Merge consecutive Whisper segments so total count matches user sentence count.
    Uses greedy text matching to decide which segments to merge.
    """
    N = len(user_sentences)
    M = len(whisper_segments)

    # Build cumulative Whisper text for each possible group
    # We need to partition M segments into N groups
    # Use dynamic programming: find the split that maximizes text similarity

    # Simple greedy: for each user sentence, consume Whisper segments until
    # the combined text best matches the user sentence
    result = []
    ws_cursor = 0

    for i, user_sent in enumerate(user_sentences):
        remaining_user = N - i
        remaining_ws = M - ws_cursor

        if remaining_user <= 0:
            break

        # Minimum segments to consume for this user sentence
        min_consume = 1
        # Maximum: leave at least 1 per remaining user sentence
        max_consume = max(1, remaining_ws - (remaining_user - 1))

        best_consume = min_consume
        best_score = -1
        user_lower = user_sent.lower()

        for consume in range(min_consume, max_consume + 1):
            # Combine text from ws_cursor to ws_cursor+consume
            combined_text = " ".join(
                whisper_segments[j]["text"]
                for j in range(ws_cursor, ws_cursor + consume)
            ).lower()

            score = SequenceMatcher(None, user_lower, combined_text).ratio()
            if score > best_score:
                best_score = score
                best_consume = consume

        # Use the best grouping
        group_start = whisper_segments[ws_cursor]["start"]
        group_end = whisper_segments[ws_cursor + best_consume - 1]["end"]

        result.append({
            "index": i,
            "startTime": round(group_start, 2),
            "endTime": round(group_end, 2),
            "text": user_sent,
        })

        ws_cursor += best_consume

    return result


def _subdivide_whisper_for_user(
    user_sentences: list[str],
    whisper_segments: list[dict],
) -> list[dict]:
    """
    When user has more sentences than Whisper segments,
    use word-level timestamps to split Whisper segments.
    """
    # Collect all words from all segments
    all_words = []
    for seg in whisper_segments:
        for w in seg.get("words", []):
            all_words.append(w)

    if not all_words:
        # Fallback: just distribute whisper segments evenly
        result = []
        for i, sent in enumerate(user_sentences):
            ws_idx = min(i, len(whisper_segments) - 1)
            ws = whisper_segments[ws_idx]
            result.append({
                "index": i,
                "startTime": round(ws["start"], 2),
                "endTime": round(ws["end"], 2),
                "text": sent,
            })
        return result

    N = len(user_sentences)
    total_words = len(all_words)

    # Distribute words proportionally by character count
    total_chars = sum(len(s) for s in user_sentences)
    if total_chars == 0:
        total_chars = 1

    result = []
    word_cursor = 0

    for i, sent in enumerate(user_sentences):
        char_ratio = len(sent) / total_chars
        word_count = max(1, round(char_ratio * total_words))

        if i == N - 1:
            word_count = total_words - word_cursor
        else:
            word_count = min(word_count, total_words - word_cursor)

        if word_count <= 0:
            # Reuse last segment's end time
            last_end = result[-1]["endTime"] if result else 0
            result.append({
                "index": i,
                "startTime": round(last_end, 2),
                "endTime": round(last_end + 0.5, 2),
                "text": sent,
            })
            continue

        seg_start = word_cursor
        seg_end = word_cursor + word_count

        result.append({
            "index": i,
            "startTime": round(all_words[seg_start]["start"], 2),
            "endTime": round(all_words[min(seg_end, total_words) - 1]["end"], 2),
            "text": sent,
        })

        word_cursor = seg_end

    return result


# ─── Startup ──────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Load model when server starts."""
    import threading
    threading.Thread(target=load_model, daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    log.info(f"Starting Whisper server on {HOST}:{PORT}")
    log.info(f"Model: {MODEL_SIZE}, Device: {DEVICE}, Compute: {COMPUTE_TYPE}")
    uvicorn.run(app, host=HOST, port=PORT)
