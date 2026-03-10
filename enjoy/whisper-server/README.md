# Whisper Server (faster-whisper)

Local FastAPI server for high-quality audio transcription using **faster-whisper** with the `large-v3-turbo` model. Includes built-in VAD (Voice Activity Detection) that filters out intro music, jingles, and other non-speech audio — critical for SVTPlay content.

## Why Use This?

The Enjoy app's built-in whisper.cpp does **not** have VAD filtering. When you run this server alongside the app, it automatically routes transcription through faster-whisper (which filters non-speech audio via Silero VAD), producing much cleaner results for SVTPlay and similar media with intro music.

If this server is not running, the app falls back to whisper.cpp automatically.

## Setup (All Platforms)

### Prerequisites

- **Python 3.10+** — [python.org/downloads](https://www.python.org/downloads/)
- **pip** (comes with Python)

### 1. Create a virtual environment (recommended)

```bash
cd enjoy/whisper-server

# macOS / Linux
python3 -m venv venv
source venv/bin/activate

# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Windows (CMD)
python -m venv venv
venv\Scripts\activate.bat
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

> **First run**: faster-whisper will automatically download the `large-v3-turbo` model (~1.6 GB). This only happens once.

### 3. Start the server

```bash
python main.py
```

The server starts on `http://localhost:8000` by default.

### 4. Configure in Enjoy App

Go to **Settings → Speech-to-Text → Whisper Server URL** and enter:

```
http://localhost:8000
```

That's it! The app will now use faster-whisper for transcription when this server is running.

## GPU Acceleration (Optional)

### NVIDIA GPU (CUDA)

```bash
pip install faster-whisper[cuda]
# or set env vars:
WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 python main.py
```

### Apple Silicon (MPS)

faster-whisper uses CTranslate2, which currently runs on CPU on macOS. Performance is still good with `large-v3-turbo`.

## Environment Variables

| Variable          | Default          | Description                  |
| ----------------- | ---------------- | ---------------------------- |
| `WHISPER_MODEL`   | `large-v3-turbo` | Model size                   |
| `WHISPER_DEVICE`  | `auto`           | `cpu`, `cuda`, or `auto`     |
| `WHISPER_COMPUTE` | `auto`           | `int8`, `float16`, or `auto` |
| `WHISPER_HOST`    | `0.0.0.0`        | Bind address                 |
| `WHISPER_PORT`    | `8000`           | Port number                  |

## Endpoints

| Method | Path          | Description              |
| ------ | ------------- | ------------------------ |
| `GET`  | `/status`     | Check if model is loaded |
| `POST` | `/transcribe` | Transcribe audio file    |
| `POST` | `/align`      | Align text to audio      |

## When Setting Up on a New Machine

1. Clone the repo
2. Follow the Setup steps above (venv → pip install → python main.py)
3. Set the Whisper Server URL in the Enjoy app settings
4. Start transcribing!
