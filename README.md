<div align="center">
  <img src="./enjoy/assets/icon.png" alt="Enjoy" width="128" />
</div>

<h3 align="center">
AI 是当今世界上最好的外语老师，Enjoy 做 AI 最好的助教。
</h3>

> **Notice:** This fork is customized for advanced language learning, adding offline transcription features, Swedish media support, and high-performance SVTPlay compatibility.

---

## 🚀 How to Install (For Users)

### Option 1: Download from Releases (Easiest)

You do not need to install anything or run code to get the app!

1. Go to the **Releases** section on the right side of this GitHub repository page (look for the "latest" tag).
2. Under the **Assets** dropdown at the bottom of the release, simply download the installer for your computer:
   - **Windows**: Download `Enjoy-0.7.9.Setup.exe`
   - **Mac (M1/M2/M3)**: Download `Enjoy-0.7.9-arm64.dmg`
   - **Mac (Intel)**: Download `Enjoy-0.7.9-x64.dmg`
3. Run the installer and you are ready to go!

### Option 2: Build from Source

If you are a developer and want to compile the Electron app yourself:

```bash
# 1. Clone the repository
git clone https://github.com/minglu-xie/everyone-can-learn-ESL.git
cd everyone-can-learn-ESL

# 2. Install dependencies (requires Node.js 20+)
yarn install

# 3. Build the application installers
yarn enjoy:make
```

The output installers will be placed inside the `enjoy/out/make/` folder.

---

## 🎙️ Highly Recommended: Setup Faster-Whisper

This application includes a built-in `whisper.cpp` engine that works immediately offline. **However, for the best experience (especially for Swedish and media like SVTPlay that includes intro music), we strongly recommend running the standalone `faster-whisper` server.**

Faster-whisper includes Voice Activity Detection (VAD) which automatically filters out intro jingles and background music that otherwise causes the standard whisper engine to hallucinate.

### How to run the `faster-whisper` server:

1. **Prerequisites**: Ensure you have Python 3.10+ installed.
2. **Download the Server Code**: Since you downloaded the app directly, you still need to download the server files:
   - Go to this repository's main page.
   - Click the green **Code** button and select **Download ZIP**.
   - Unzip the file to your computer.
3. **Open your terminal** and navigate to the extracted server folder:
   ```bash
   cd path/to/everyone-can-learn-ESL/enjoy/whisper-server
   ```
4. **Create a virtual environment and install dependencies**:

   ```bash
   # On macOS / Linux
   python3 -m venv venv
   source venv/bin/activate

   # On Windows
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

5. **Install the requirements**:
   ```bash
   pip install -r requirements.txt
   ```
   _(Note: The first time you run the server, it will download the 1.6GB `large-v3-turbo` model)._
6. **Start the server**:
   ```bash
   python main.py
   ```
7. **Connect the App**: Open the Enjoy app, go to **Settings → Speech-to-Text → Whisper Server URL**, and type in `http://localhost:8000`.

That's it! As long as that Python terminal is running in the background, the app will automatically route all heavy speech transcription through it for the highest quality results. If you close the terminal, the app will gracefully fall back to the built-in local fallback engine.

---

## 📖 Additional Resources

### 一千小时（2024）

- [简要说明](https://1000h.org/intro.html)
- [训练任务](https://1000h.org/training-tasks/kick-off.html)
- [语音塑造](https://1000h.org/sounds-of-american-english/0-intro.html)
- [大脑内部](https://1000h.org/in-the-brain/01-inifinite.html)
- [自我训练](https://1000h.org/self-training/00-intro.html)

### 人人都能用英语（2010）

- [简介](./book/README.md)
- [第一章：起点](./book/chapter1.md)
- [第二章：口语](./book/chapter2.md)
- [第三章：语音](./book/chapter3.md)
- [第四章：朗读](./book/chapter4.md)
- [第五章：词典](./book/chapter5.md)
- [第六章：语法](./book/chapter6.md)
- [第七章：精读](./book/chapter7.md)
- [第八章：叮嘱](./book/chapter8.md)
- [后记](./book/end.md)

## 常见问题

请查询 [文档 FAQ](https://1000h.org/enjoy-app/faq.html)。
