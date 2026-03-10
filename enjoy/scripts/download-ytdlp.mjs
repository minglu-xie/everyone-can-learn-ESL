#!/usr/bin/env zx

import axios from "axios";
import progress from "progress";

// yt-dlp release version to download
const YTDLP_VERSION = "2024.12.23";
const YTDLP_BASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`;

const platform = process.platform;
const dir = path.join(process.cwd(), "lib/yt-dlp");

// Determine binary name and download URL based on platform
let binaryName;
let downloadUrl;

if (platform === "darwin") {
  binaryName = "yt-dlp";
  downloadUrl = `${YTDLP_BASE_URL}/yt-dlp_macos`;
} else if (platform === "win32") {
  binaryName = "yt-dlp.exe";
  downloadUrl = `${YTDLP_BASE_URL}/yt-dlp.exe`;
} else {
  console.info(chalk.yellow(`⚠️ yt-dlp download skipped: unsupported platform "${platform}"`));
  process.exit(0);
}

const binaryPath = path.join(dir, binaryName);

console.info(chalk.blue(`=> Download yt-dlp ${YTDLP_VERSION} for ${platform}`));

// Check if binary already exists
fs.ensureDirSync(dir);
try {
  if (fs.statSync(binaryPath).isFile()) {
    console.info(chalk.green(`✅ yt-dlp binary already exists at ${binaryPath}`));
    process.exit(0);
  }
} catch (err) {
  if (err && err.code !== "ENOENT") {
    console.error(chalk.red(`❌ Error: ${err}`));
    process.exit(1);
  }
}

// Handle proxy
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxyUrl) {
  const { hostname, port, protocol } = new URL(proxyUrl);
  axios.defaults.proxy = {
    host: hostname,
    port: port,
    protocol: protocol,
  };
}

const download = async (url, dest) => {
  console.info(chalk.blue(`=> Downloading from ${url}`));
  return axios
    .get(url, { responseType: "stream", maxRedirects: 5 })
    .then((response) => {
      const totalLength = response.headers["content-length"];

      const progressBar = new progress("-> downloading [:bar] :percent :etas", {
        width: 40,
        complete: "=",
        incomplete: " ",
        renderThrottle: 1,
        total: parseInt(totalLength),
      });

      response.data.on("data", (chunk) => {
        progressBar.tick(chunk.length);
      });

      return new Promise((resolve, reject) => {
        response.data
          .pipe(fs.createWriteStream(dest))
          .on("close", () => {
            console.info(chalk.green(`✅ yt-dlp downloaded to ${dest}`));
            // Make executable on macOS
            if (platform === "darwin") {
              fs.chmodSync(dest, 0o755);
              console.info(chalk.green(`✅ Made executable`));
            }
            resolve();
          })
          .on("error", reject);
      });
    })
    .catch((err) => {
      console.error(
        chalk.red(
          `❌ Failed to download yt-dlp: ${err}.\nPlease try again using command \`yarn run download-ytdlp\``
        )
      );
      process.exit(1);
    });
};

await download(downloadUrl, binaryPath);
