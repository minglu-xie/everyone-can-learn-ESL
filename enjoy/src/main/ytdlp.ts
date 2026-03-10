import path from "path";
import { spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import log from "@main/logger";
import snakeCase from "lodash/snakeCase";
import settings from "@main/settings";
import mainWin from "@main/window";

// yt-dlp bin file will be in /app.asar.unpacked instead of /app.asar
const __dirname = import.meta.dirname.replace("app.asar", "app.asar.unpacked");

const logger = log.scope("YTDLP");

const TEN_MINUTES = 1000 * 60 * 10;

const validDomains = new Set([
  "svtplay.se",
  "www.svtplay.se",
  "sverigesradio.se",
  "www.sverigesradio.se",
  "urplay.se",
  "www.urplay.se",
]);

type YtdlpDownloadResult = {
  mediaPath: string;
  subtitlePath: string | null;
  title: string;
};

class Ytdlp {
  private binFile: string;
  private abortController: AbortController | null = null;

  constructor() {
    const binName = os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp";

    // In production build, vite copies the correct arch/platform binary to lib/yt-dlp/
    const flatBin = path.join(__dirname, "lib", "yt-dlp", binName);

    // In dev/source, binaries are in lib/yt-dlp/{arch}/{platform}/
    const archBin = path.join(
      __dirname,
      "lib",
      "yt-dlp",
      os.arch(),
      os.platform(),
      binName
    );

    if (fs.existsSync(flatBin)) {
      this.binFile = flatBin;
    } else if (fs.existsSync(archBin)) {
      this.binFile = archBin;
    } else {
      // Fallback to system yt-dlp
      this.binFile = "yt-dlp";
      logger.warn(`Bundled yt-dlp not found, using system yt-dlp`);
    }
  }

  /**
   * Try to update the bundled yt-dlp from system installation.
   * Call this if the bundled version fails (e.g. extractor outdated).
   */
  private async trySystemFallback(): Promise<string | null> {
    try {
      const { execSync } = await import("child_process");
      const systemBin = execSync("which yt-dlp 2>/dev/null || where yt-dlp 2>nul", {
        encoding: "utf-8",
      }).trim().split("\n")[0];
      if (systemBin && fs.existsSync(systemBin)) {
        logger.info(`Found system yt-dlp at ${systemBin}`);
        return systemBin;
      }
    } catch {
      // no system yt-dlp available
    }
    return null;
  }

  /**
   * Check if URL is from a supported Swedish media site
   */
  validateURL = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return validDomains.has(parsed.hostname);
    } catch {
      return false;
    }
  };

  /**
   * Download media and subtitles from a supported URL.
   * Retries with system yt-dlp if bundled binary fails.
   */
  async download(
    url: string,
    options: {
      type?: "audio" | "video";
      directory?: string;
      webContents?: Electron.WebContents;
    } = {}
  ): Promise<YtdlpDownloadResult> {
    this.abortController?.abort();
    this.abortController = new AbortController();

    const {
      type = "audio",
      directory = settings.cachePath(),
      webContents = mainWin.win.webContents,
    } = options;

    fs.ensureDirSync(directory);

    // Build yt-dlp arguments
    const args: string[] = [
      url,
      "--no-playlist",
      "--write-sub",
      "--sub-lang", "sv",
      "--convert-subs", "srt",
      "-o", path.join(directory, "%(title)s.%(ext)s"),
    ];

    if (type === "audio") {
      args.push("--extract-audio", "--audio-format", "mp3");
    } else {
      args.push(
        "--format",
        "bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best"
      );
    }

    // Try bundled binary first
    try {
      return await this._spawnDownload(this.binFile, args, directory, url, webContents);
    } catch (err) {
      logger.warn(`Bundled yt-dlp failed: ${err.message}. Trying system yt-dlp...`);
      const systemBin = await this.trySystemFallback();
      if (systemBin) {
        this.abortController = new AbortController();
        return await this._spawnDownload(systemBin, args, directory, url, webContents);
      }
      throw err;
    }
  }

  /**
   * Spawn yt-dlp process and return download result
   */
  private _spawnDownload(
    binFile: string,
    args: string[],
    directory: string,
    url: string,
    webContents: Electron.WebContents,
  ): Promise<YtdlpDownloadResult> {
    logger.info(`Running yt-dlp: ${binFile} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(binFile, args, {
        timeout: TEN_MINUTES,
        signal: this.abortController.signal,
        env: this.proxyEnv(),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        const output = data.toString();
        stdout += output;

        // Parse progress: [download]  45.2% of ~5.00MiB ...
        const match = output.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (match) {
          webContents.send("download-on-state", {
            name: url,
            state: "progressing",
            received: parseFloat(match[1]),
            speed: "",
          });
        }
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          logger.error(`yt-dlp exited with code ${code}: ${stderr}`);
          webContents.send("download-on-state", {
            name: url,
            state: "interrupted",
          });
          return reject(
            new Error(`yt-dlp download failed (code ${code}): ${stderr.slice(0, 200)}`)
          );
        }

        // Find the downloaded media file
        const mediaPath = this.findDownloadedMedia(stdout, directory);
        if (!mediaPath) {
          return reject(new Error("yt-dlp: could not locate downloaded media file"));
        }

        // Find subtitle file
        const subtitlePath = this.findSubtitleFile(directory, mediaPath);

        // Extract title from filename
        const title = path.basename(mediaPath, path.extname(mediaPath));

        logger.info(`Download complete: media=${mediaPath}, subtitle=${subtitlePath}`);

        resolve({
          mediaPath,
          subtitlePath,
          title,
        });
      });
    });
  }

  /**
   * Parse yt-dlp stdout to find the final downloaded media file path.
   * yt-dlp logs lines like:
   *   [download] Destination: /path/to/file.mp3
   *   [ExtractAudio] Destination: /path/to/file.mp3
   *   [Merger] Merging formats into "/path/to/file.mp4"
   */
  private findDownloadedMedia(stdout: string, directory: string): string | null {
    // Try to match merger output (video)
    const mergerMatch = stdout.match(/\[Merger\] Merging formats into "(.+?)"/);
    if (mergerMatch && fs.existsSync(mergerMatch[1])) {
      return mergerMatch[1];
    }

    // Try to match ExtractAudio destination (audio)
    const extractMatch = stdout.match(/\[ExtractAudio\] Destination: (.+)/);
    if (extractMatch) {
      const p = extractMatch[1].trim();
      if (fs.existsSync(p)) return p;
    }

    // Try to match download destination
    const downloadMatch = stdout.match(/\[download\] Destination: (.+)/);
    if (downloadMatch) {
      const p = downloadMatch[1].trim();
      if (fs.existsSync(p)) return p;
    }

    // Fallback: look for recently created media files in directory
    const mediaExts = [".mp3", ".mp4", ".m4a", ".webm", ".mkv"];
    const files = fs.readdirSync(directory)
      .filter((f) => mediaExts.includes(path.extname(f).toLowerCase()))
      .map((f) => ({
        name: f,
        path: path.join(directory, f),
        mtime: fs.statSync(path.join(directory, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  }

  /**
   * Find subtitle file (.vtt or .srt) matching the media filename
   */
  findSubtitleFile(directory: string, mediaPath: string): string | null {
    const baseName = path.basename(mediaPath, path.extname(mediaPath));
    const candidates = fs.readdirSync(directory).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return (
        (ext === ".srt" || ext === ".vtt") &&
        f.startsWith(baseName)
      );
    });

    if (candidates.length === 0) return null;

    // Prefer .sv.srt over others
    const svSrt = candidates.find((f) => f.includes(".sv.") && f.endsWith(".srt"));
    if (svSrt) return path.join(directory, svSrt);

    // Fallback to first match
    return path.join(directory, candidates[0]);
  }

  /**
   * Clean VTT content from SVT/UR by stripping STYLE blocks, HTML tags,
   * cue IDs (hex hashes), and position/alignment metadata.
   * Preserves valid VTT structure for downstream parseText().
   */
  cleanVttContent(raw: string): string {
    let lines = raw.split("\n");
    let result: string[] = [];
    let inStyleBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip STYLE blocks
      if (line === "STYLE") {
        inStyleBlock = true;
        continue;
      }
      if (inStyleBlock) {
        if (line === "") inStyleBlock = false;
        continue;
      }

      // Skip hex cue IDs (32-char hex strings used by SVT)
      if (/^[0-9a-f]{20,}$/i.test(line)) continue;

      // Strip position/alignment metadata from timing lines
      let cleaned = line.replace(/\s+(align|position|line|size|vertical):[^\s]*/g, "");

      // Strip HTML-like cue tags: <c.relive>, </c>, <b>, </b>, <i>, </i>
      cleaned = cleaned.replace(/<\/?[a-z][a-z0-9.]*>/gi, "");

      result.push(cleaned);
    }

    return result.join("\n");
  }

  /**
   * Abort an ongoing download
   */
  abortDownload() {
    this.abortController?.abort();
  }

  /**
   * Set the proxy environment variables
   */
  private proxyEnv = () => {
    let env = { ...process.env };
    const proxyConfig = settings.getSync("proxy") as ProxyConfigType;
    if (proxyConfig.enabled && proxyConfig.url) {
      env["HTTP_PROXY"] = proxyConfig.url;
      env["HTTPS_PROXY"] = proxyConfig.url;
    }
    return env;
  };
}

export default new Ytdlp();
