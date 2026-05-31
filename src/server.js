const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { parseArgs } = require("./config");
const { getMimeType, isVideoFile, listVideos, resolveInsideRoot } = require("./media");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const DATA_DIR = process.env.LAN_VIDEO_SHARE_DATA_DIR || path.resolve(__dirname, "..", "data");
const PREFERENCES_FILE = path.join(DATA_DIR, "preferences.json");
const MAX_JSON_BODY_SIZE = 1024 * 1024;
const EMPTY_PREFERENCES = {
  blocked: {},
  favorite: {}
};

let preferencesWriteQueue = Promise.resolve();

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function isUnsafePreferenceKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function normalizePreferenceMap(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalized;
  }

  for (const [key, timestamp] of Object.entries(value)) {
    if (!key || isUnsafePreferenceKey(key)) {
      continue;
    }
    const numberValue = Number(timestamp);
    if (Number.isFinite(numberValue) && numberValue > 0) {
      normalized[key] = numberValue;
    }
  }

  return normalized;
}

function normalizePreferences(value) {
  return {
    blocked: normalizePreferenceMap(value?.blocked),
    favorite: normalizePreferenceMap(value?.favorite),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
  };
}

function applyPreferenceAction(preferences, action, videoId, now = Date.now()) {
  if (!videoId || typeof videoId !== "string" || isUnsafePreferenceKey(videoId)) {
    throw new Error("Invalid videoId");
  }

  const next = normalizePreferences(preferences);
  if (action === "favorite") {
    next.favorite[videoId] = now;
    delete next.blocked[videoId];
  } else if (action === "unfavorite") {
    delete next.favorite[videoId];
  } else if (action === "block") {
    next.blocked[videoId] = now;
    delete next.favorite[videoId];
  } else if (action === "unblock") {
    delete next.blocked[videoId];
  } else {
    throw new Error("Invalid action");
  }
  next.updatedAt = new Date(now).toISOString();
  return next;
}

async function readPreferences() {
  try {
    const content = await fsp.readFile(PREFERENCES_FILE, "utf8");
    return normalizePreferences(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizePreferences(EMPTY_PREFERENCES);
    }
    throw error;
  }
}

async function writePreferences(preferences) {
  const normalized = normalizePreferences({
    ...preferences,
    updatedAt: preferences.updatedAt || new Date().toISOString()
  });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${PREFERENCES_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fsp.rename(tempFile, PREFERENCES_FILE);
  return normalized;
}

function readRequestBody(req, limit = MAX_JSON_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handlePreferences(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, await readPreferences());
    return;
  }

  if (req.method !== "PATCH") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch {
    sendError(res, 400, "Invalid JSON");
    return;
  }

  try {
    const writeOperation = preferencesWriteQueue.catch(() => {}).then(async () => {
      const current = await readPreferences();
      const next = applyPreferenceAction(current, payload.action, payload.videoId);
      return writePreferences(next);
    });
    preferencesWriteQueue = writeOperation.catch(() => {});
    sendJson(res, 200, await writeOperation);
  } catch (error) {
    sendError(res, error.message === "Invalid action" || error.message === "Invalid videoId" ? 400 : 500, error.message);
  }
}

function acceptsRequest(req, token) {
  if (!token) {
    return true;
  }

  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("token") === token || req.headers.authorization === `Bearer ${token}`;
}

async function serveStatic(req, res, pathname) {
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolveInsideRoot(PUBLIC_DIR, fileName);

  if (!filePath) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      sendError(res, 404, "Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": getMimeType(filePath),
      "Content-Length": stat.size,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [startText, endText] = rangeHeader.slice(6).split("-");
  let start = startText === "" ? null : Number.parseInt(startText, 10);
  let end = endText === "" ? null : Number.parseInt(endText, 10);

  if (start === null && end !== null) {
    start = Math.max(size - end, 0);
    end = size - 1;
  } else {
    end = end === null ? size - 1 : end;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) {
    return null;
  }

  return { start, end };
}

async function serveVideo(req, res, rootDir, encodedPath) {
  const clientPath = decodeURIComponent(encodedPath);
  const filePath = resolveInsideRoot(rootDir, clientPath);

  if (!filePath || !isVideoFile(filePath)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "Video not found");
      return;
    }
    throw error;
  }

  if (!stat.isFile()) {
    sendError(res, 404, "Video not found");
    return;
  }

  const range = parseRange(req.headers.range, stat.size);
  const headers = {
    "Content-Type": getMimeType(filePath),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600"
  };

  if (range) {
    const chunkSize = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      "Content-Length": chunkSize
    });
    fs.createReadStream(filePath, range).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    "Content-Length": stat.size
  });
  fs.createReadStream(filePath).pipe(res);
}

function createServer(config) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/api/videos") {
        if (!acceptsRequest(req, config.token)) {
          sendError(res, 401, "Unauthorized");
          return;
        }

        const videos = await listVideos(config.rootDir);
        sendJson(res, 200, {
          rootDir: config.rootDir,
          count: videos.length,
          videos
        });
        return;
      }

      if (url.pathname === "/api/preferences") {
        if (!acceptsRequest(req, config.token)) {
          sendError(res, 401, "Unauthorized");
          return;
        }

        await handlePreferences(req, res);
        return;
      }

      if (url.pathname.startsWith("/video/")) {
        if (!acceptsRequest(req, config.token)) {
          sendError(res, 401, "Unauthorized");
          return;
        }

        await serveVideo(req, res, config.rootDir, url.pathname.slice("/video/".length));
        return;
      }

      await serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendError(res, 500, "Internal server error");
      } else {
        res.destroy(error);
      }
    }
  });
}

function getLanAddresses(port) {
  const addresses = [];
  const interfaces = os.networkInterfaces();

  for (const details of Object.values(interfaces)) {
    for (const item of details || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.push(`http://${item.address}:${port}`);
      }
    }
  }

  return addresses;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const stat = await fsp.stat(config.rootDir);
  if (!stat.isDirectory()) {
    throw new Error(`Share path is not a directory: ${config.rootDir}`);
  }

  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`Sharing: ${config.rootDir}`);
    console.log(`Local:   http://localhost:${config.port}`);
    for (const address of getLanAddresses(config.port)) {
      console.log(`Network: ${address}`);
    }
    if (config.token) {
      console.log("Token:   enabled; append ?token=... or use Authorization: Bearer token");
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applyPreferenceAction,
  createServer,
  normalizePreferences,
  parseRange
};
