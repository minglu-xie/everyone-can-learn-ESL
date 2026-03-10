# 媒体下载与本地字幕支持分析 (Media Download & Local Subtitle Integration)

针对您提出的两个问题，以下是详细的分析、实现思路、潜在风险以及注意事项。

## 1. 支持瑞典媒体站点（SVT Play, Sveriges Radio, UR Play）下载

### 难度评估: **中等 (Moderate)**

目前项目中处理流媒体下载使用的是一个用 Go 编写的工具 `youtubedr`，其在 `enjoy/src/main/youtubedr.ts` 中被直接调用。该工具是专门针对 YouTube 设计的，无法天然支持 SVT Play 等其他站点。

**实现方案:**
要支持更广泛的站点，业界标准的解决方案是集成 **`yt-dlp`**。`yt-dlp` 原生支持 SVT Play, Sveriges Radio 和 UR Play 等数百个媒体网站，并且可以同时抓取相应的媒体及其内置或外挂字幕。

- **替换/共存策略:** 我们可以在 `src/main/providers` 下新增一个基于 `yt-dlp` 的 Provider。
- **打包分发:** 需要像内置 `youtubedr` 或 `ffmpeg` 一样，在项目的预构建脚本（或通过第三方包如 `youtube-dl-exec` 并配置下载 `yt-dlp` 二进制文件）中将 `yt-dlp` 打包进应用中，以保证全平台的兼容性。

---

## 2. 把下载的字幕文件添加到“下载字幕”菜单中？

### 难度评估: **低 (Low) - 且体验可以做得更好**

您在截图中指出的“下载字幕”功能，其实际业务逻辑（位于 `transcriptions-list.tsx`）是向 Enjoy 的云端服务器查询是否有其他用户通过 MD5 分享过的云端字幕。

如果我们在下载音视频的同时，已经通过 `yt-dlp` 成功下载了对应的本地字幕文件（如 `.vtt` 或 `.srt`），我们**不需要**把它放到那个云端下载列表中。最好的体验是：**静默解析并直接作为本地生成好的数据导入**。

**实现方案:**

1. **下载后检测:** 当使用 `yt-dlp` 提取了本地视频和本地字幕格式（通常是 `vtt`）后。
2. **解析字幕:** 编写一个解析器读取 `.vtt` 文件，提取出带有时间戳的片段列表，并转换为 Enjoy App 内部使用的 `TranscriptionType` 数据结构（包含 `timeline: {text, startTime, endTime}[]`）。
3. **直接写入数据库:** 仿照 Whisper 转录完成后的逻辑，直接调用 `TranscriptionsHandler.update`/`findOrCreate` 将其写入本地 SQLite 库。
4. **效果:** 用户甚至不需要点击任何按钮。应用在载入该媒体时会发现“我已经有转录结果了”，从而直接越过“正在准备音频”的弹窗，瞬间进入可点读/学习状态！该字幕的引擎标记可以设为 `source` 或 `yt-dlp`。

---

## 3. 潜在 Bug (Potential Bugs)

1. **时间轴同步偏移 (Timestamp Sync Issues):** 官方提供的字幕有时是为了电视广播准备的，可能和实际扒下来的视频存在几百毫秒级别的轻微时间偏移，影响点读高亮的体验。
2. **多语言与字幕格式冗杂:** `yt-dlp` 下载时可能包含多个字幕轨道（如瑞典语、瑞典语听障版，甚至是自动翻译版）。程序需要准确筛选出默认的或最适合学习的瑞典语字幕，否则可能会把错误的 `.vtt` 导入进去。
3. **各种格式的解析兼容性:** 如果 Sveriges Radio 给的是 `.srt`，而 SVT 给的是 `.vtt`，我们的解析器必须具备较强的容错和兼容能力。
4. **yt-dlp 依赖体积/环境:** 引入 `yt-dlp` 的独立二进制文件大约会增加应用 20MB-30MB 的体积。

---

## 4. 重点提醒与优势 (Reminders & Advantages)

- **节省 Token 和 计算资源 (Token & Prompt Saving):**
  直接使用官方字幕不仅能**100% 节约**用来做 Whisper 转录或云端大模型修正所需的算力/Token 和 API 成本，还可以绕过目前 Whisper 提示词在个别方言和生僻词上带来的幻觉问题！官方的文本极其准确，特别适合作为语言学习的 Ground Truth。
- **与当前架构集成无碍:**
  只要字幕内容被成功解析进本地数据库的 `transcriptions` 表中，后面所有的“高亮播放”、“单词查询 (Lookup)”、“句子分析 (Analyze)” 都能无缝继续工作，完全不需要修改核心功能的逻辑，这也是最漂亮的一点。

---

## 5. 上一轮讨论的自评 (Evaluation of Previous Round)

上一轮的分析**方向正确，但以下几点需要修正和深化：**

| 方面             | 上轮说法                            | 修正/深化                                                                                                                                                                    |
| ---------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字幕解析器       | "编写一个解析器"                    | **不需要从头写。** 项目已经依赖 `media-captions` 库，`use-transcribe.tsx` 中的 `alignText()` 函数（L216-280）已实现了 SRT/VTT → `segmentTimeline` 的完整解析。直接复用即可。 |
| "直接写入数据库" | 简单提及                            | 写入前还需经过 **echogarden 的 DTW 对齐步骤**（`alignSegments` + `wordToSentenceTimeline`），才能生成精确到词级别的时间轴。不能跳过。                                        |
| 数据结构         | 仅提及 `{text, startTime, endTime}` | 应为完整的 `TimelineEntry`（来自 echogarden），包含 `type`, `text`, `startTime`, `endTime`, `timeline[]`（嵌套的词级时间轴）。                                               |
| "下载字幕"按钮   | 建议绕过它                          | 仍然**可以考虑**在这个 tab 下增加一行"本地字幕文件"的选项，给用户一个显式的操作入口。两种方式可以并存。                                                                      |

---

## 6. 如何将下载字幕与 Whisper.cpp 转录结合？(Combining Downloaded Subtitles & Whisper)

这是最有价值的问题。现有代码已经提供了两条路径，我们可以**组合使用**：

### 路径 A：字幕作为"上传文本"直接对齐（推荐，零 Token 消耗）

这正是 `use-transcribe.tsx` 中 `service === "upload"` 分支的逻辑：

```
用户选择"语音转文本" → 选 service="upload" → 粘贴/传入 SRT/VTT 文本
  → alignText() 用 media-captions 解析出 segmentTimeline
  → echogarden.alignSegments() 做 DTW 音频对齐
  → wordToSentenceTimeline() 生成最终 timeline
  → 保存到 transcriptions 表
```

**如何自动化：** 在 `yt-dlp` 下载完成后，如果检测到同目录下存在 `.vtt`/`.srt` 文件，自动读取其内容并走上述 `upload` 路径，用户无需手动操作。

**优势：**

- **零 Whisper Token/计算消耗**
- 官方字幕文本 100% 准确（无幻觉）
- 字幕中已有粗粒度时间戳，DTW 对齐只需微调，速度极快

### 路径 B：字幕作为 Whisper prompt 的辅助（补充方案）

如果某些瑞典媒体没有提供字幕，仍需 Whisper 转录。此时可以：

1. 先用 `yt-dlp` 尝试下载字幕
2. **有字幕 → 走路径 A（推荐）**
3. **无字幕 → 走 Whisper.cpp 本地转录**（即 `SttEngineOptionEnum.LOCAL`）
4. Whisper 转录完后同样经过 `alignSegments()` 对齐

### 路径 C：混合模式（高级，未来可选）

对于部分有字幕但字幕有缺失（如广告段缺字幕）的场景：

1. 用官方字幕覆盖有字幕的时间段
2. 用 Whisper 转录填补无字幕的空白段
3. 合并两个 `segmentTimeline` 数组，然后统一做 DTW 对齐

> ⚠️ 路径 C 复杂度高，建议作为二期功能，初期只做 A + B 的自动切换。

### 完整数据流示意

```
yt-dlp download
  ├── media file (.mp4/.mp3)
  └── subtitle file (.vtt/.srt)  ← 可能有也可能没有
        │
        ├── [有字幕] → parseText(vtt) → segmentTimeline
        │     → echogarden.alignSegments(audio, segments)
        │     → wordToSentenceTimeline()
        │     → splitLongSegments()
        │     → transcriptions.update({ engine:"source", result: {timeline} })
        │     → ✅ 直接进入学习（跳过弹窗）
        │
        └── [无字幕] → Whisper.cpp 转录
              → echogarden.recognize(audio)
              → segmentTimeline
              → alignSegments() → wordToSentenceTimeline()
              → transcriptions.update({ engine:"whisper" })
              → ✅ 进入学习
```

---

## 7. 额外提醒 (Additional Reminders)

1. **`parseText` 同时支持 SRT 和 VTT：** 在 Cloudflare 转录分支（L404-414）中，项目已成功使用 `parseText(res.vtt, { type: "vtt" })` 解析 VTT。SRT 在 `alignText()` 中也有使用（L226）。两种格式都无需额外引入依赖。
2. **`splitLongSegments()` 已存在：** 该函数（L36-70）会将超过 20 字符的长句在标点处切分并按比例插值时间戳，适合瑞典语句子的处理。
3. **语言代码注意：** Whisper 和 echogarden 用的是 ISO 639-1 两字符码（`sv`），而 Azure STT 用的是 BCP-47 全码（`sv-SE`）。`language.split("-")[0]` 的逻辑已在代码中多处使用，新代码应保持一致。
4. **SVT/UR 特有的字幕格式：** 部分 SVT 节目的字幕可能包含 `<b>`, `<i>` 等 HTML 标签或位置信息（如 `position:`, `align:`），`media-captions` 会提取纯文本，但建议测试确认没有残留标签混入 `cue.text`。
