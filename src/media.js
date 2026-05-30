const fs = require("node:fs/promises");
const path = require("node:path");

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".flv",
  ".ts",
  ".m3u8"
]);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".wmv", "video/x-ms-wmv"],
  [".flv", "video/x-flv"],
  [".ts", "video/mp2t"],
  [".m3u8", "application/vnd.apple.mpegurl"]
]);

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getMimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function toClientPath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function listVideos(rootDir) {
  const videos = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !isVideoFile(entry.name)) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      const relativePath = path.relative(rootDir, fullPath);
      videos.push({
        id: toClientPath(relativePath),
        name: entry.name,
        folder: toClientPath(path.dirname(relativePath)) === "." ? "" : toClientPath(path.dirname(relativePath)),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        url: `/video/${encodeURIComponent(toClientPath(relativePath))}`
      });
    }
  }

  await walk(rootDir);
  return videos;
}

function resolveInsideRoot(rootDir, clientPath) {
  const normalizedClientPath = clientPath.replaceAll("/", path.sep);
  const resolved = path.resolve(rootDir, normalizedClientPath);
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;

  if (resolved !== rootDir && !resolved.startsWith(rootWithSep)) {
    return null;
  }

  return resolved;
}

module.exports = {
  getMimeType,
  isVideoFile,
  listVideos,
  resolveInsideRoot,
  VIDEO_EXTENSIONS
};
