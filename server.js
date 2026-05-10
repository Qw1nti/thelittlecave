const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const LIBRARY_DIR = path.join(ROOT, "library");
const DOWNLOADS_DIR = path.join(ROOT, "downloads");
const ENV_PATH = path.join(ROOT, ".env");
const HERENOW_CREDENTIALS_PATH = path.join(os.homedir(), ".herenow", "credentials");
const audioExtensions = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const stateStore = new Map();
const sessionStore = new Map();
const downloadJobs = new Map();

loadEnvFile();
const PORT = Number(process.env.PORT || 4310);
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-session-secret";
const SPOTDL_BIN = process.env.SPOTDL_BIN || "spotdl";
const SPOTIFY_SCOPES =
  process.env.SPOTIFY_SCOPES ||
  "user-read-email user-read-private playlist-read-private playlist-read-collaborative user-read-recently-played user-top-read";
ensureDir(LIBRARY_DIR);
ensureDir(DOWNLOADS_DIR);

const spotifyConfig = {
  clientId: process.env.SPOTIFY_CLIENT_ID || "",
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || "",
  scopes: SPOTIFY_SCOPES
};

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const route = parsedUrl.pathname;

    if (req.method === "GET" && route === "/api/config") {
      return sendJson(res, 200, {
        spotifyConfigured: isSpotifyConfigured(),
        spotifyRedirectUri: getSpotifyRedirectUri(req),
        libraryFolders: ["library", "downloads"],
        spotdl: {
          configuredBin: SPOTDL_BIN
        }
      });
    }

    if (req.method === "GET" && route === "/api/library") {
      return sendJson(res, 200, {
        tracks: listAudioTracks()
      });
    }

    if (req.method === "POST" && route === "/api/library/import") {
      return importLibraryTrack(req, res);
    }

    if (req.method === "GET" && route.startsWith("/api/stream/")) {
      return streamTrack(req, res, route.slice("/api/stream/".length));
    }

    if (req.method === "POST" && route === "/api/download") {
      const body = await readJsonBody(req);
      return queueDownload(res, body);
    }

    if (req.method === "GET" && route === "/api/downloads") {
      return sendJson(res, 200, {
        jobs: Array.from(downloadJobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      });
    }

    if (req.method === "GET" && route === "/api/spotify/login") {
      return startSpotifyLogin(req, res);
    }

    if (req.method === "GET" && route === "/api/spotify/callback") {
      return handleSpotifyCallback(req, res, parsedUrl);
    }

    if (req.method === "POST" && route === "/api/spotify/logout") {
      return logoutSpotify(req, res);
    }

    if (req.method === "GET" && route === "/api/spotify/status") {
      return getSpotifyStatus(req, res);
    }

    if (req.method === "GET" && route === "/api/spotify/me") {
      return proxySpotifyRequest(req, res, "https://api.spotify.com/v1/me");
    }

    if (req.method === "GET" && route === "/api/spotify/playlists") {
      return proxySpotifyRequest(
        req,
        res,
        "https://api.spotify.com/v1/me/playlists?limit=12"
      );
    }

    if (req.method === "GET" && route === "/api/spotify/recent") {
      return proxySpotifyRequest(
        req,
        res,
        "https://api.spotify.com/v1/me/player/recently-played?limit=12"
      );
    }

    if (req.method === "GET" && route === "/api/spotify/top") {
      return proxySpotifyRequest(
        req,
        res,
        "https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term"
      );
    }

    if (req.method === "GET" && route === "/api/spotify/search") {
      const query = parsedUrl.searchParams.get("q") || "";
      if (!query.trim()) {
        return sendJson(res, 400, { error: "Missing search query." });
      }
      return proxySpotifyRequest(
        req,
        res,
        `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(query)}`
      );
    }

    if (req.method === "GET") {
      return serveStaticAsset(res, route);
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "Internal server error.",
      detail: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Retro player listening at http://127.0.0.1:${PORT}`);
});

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  });
  res.end(body);
}

async function readRequestBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function listAudioTracks() {
  const sources = [
    { key: "library", root: LIBRARY_DIR },
    { key: "downloads", root: DOWNLOADS_DIR }
  ];

  const tracks = [];

  for (const source of sources) {
    walkAudioFiles(source.root, (absolutePath) => {
      tracks.push(buildTrackRecord(source.key, absolutePath));
    });
  }

  return tracks.sort((a, b) => a.title.localeCompare(b.title));
}

function resolveLibraryImportPath(relativePathHeader, fileNameHeader) {
  const requestedPath = decodeURIComponent(relativePathHeader || fileNameHeader || "").replace(/\\/g, "/");
  const fallbackName = decodeURIComponent(fileNameHeader || "upload.bin");
  const chosenPath = requestedPath || fallbackName;
  const normalizedPath = path.posix.normalize(chosenPath).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath === "." || normalizedPath.endsWith("/")) {
    throw new Error("Invalid import path.");
  }

  const absolutePath = path.resolve(LIBRARY_DIR, normalizedPath);
  if (!absolutePath.startsWith(LIBRARY_DIR)) {
    throw new Error("Import path rejected.");
  }

  if (!audioExtensions.has(path.extname(absolutePath).toLowerCase())) {
    throw new Error("Only supported audio files can be imported.");
  }

  return {
    absolutePath,
    relativePath: normalizedPath
  };
}

async function importLibraryTrack(req, res) {
  const fileNameHeader = req.headers["x-file-name"];
  const relativePathHeader = req.headers["x-relative-path"];
  let destination;

  try {
    destination = resolveLibraryImportPath(relativePathHeader, fileNameHeader);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  const payload = await readRequestBuffer(req);
  if (!payload.length) {
    return sendJson(res, 400, { error: "Uploaded file is empty." });
  }

  ensureDir(path.dirname(destination.absolutePath));
  fs.writeFileSync(destination.absolutePath, payload);

  let driveSync = null;
  try {
    const syncResult = await syncFilesToHereNowDrive([destination.absolutePath], {
      rootDir: LIBRARY_DIR,
      drivePrefix: "library"
    });
    driveSync = {
      status: "completed",
      driveId: syncResult.driveId,
      driveName: syncResult.driveName,
      uploadedFiles: syncResult.uploadedFiles
    };
  } catch (error) {
    driveSync = {
      status: "failed",
      error: error.message
    };
  }

  return sendJson(res, 201, {
    message: "Track imported.",
    track: buildTrackRecord("library", destination.absolutePath),
    driveSync
  });
}

function walkAudioFiles(rootDir, onFile) {
  if (!fs.existsSync(rootDir)) {
    return;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkAudioFiles(absolutePath, onFile);
      continue;
    }
    if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
      onFile(absolutePath);
    }
  }
}

function buildTrackRecord(sourceKey, absolutePath) {
  const root = getRootForSource(sourceKey);
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
  const stats = fs.statSync(absolutePath);
  const title = path.basename(absolutePath, path.extname(absolutePath));
  const id = encodeTrackId(sourceKey, relativePath);
  return {
    id,
    source: sourceKey,
    title,
    relativePath,
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
    url: `/api/stream/${id}`
  };
}

function encodeTrackId(source, relativePath) {
  return Buffer.from(`${source}:${relativePath}`, "utf8").toString("base64url");
}

function decodeTrackId(id) {
  const decoded = Buffer.from(id, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    throw new Error("Invalid track identifier.");
  }

  return {
    source: decoded.slice(0, separator),
    relativePath: decoded.slice(separator + 1)
  };
}

function getRootForSource(source) {
  if (source === "library") {
    return LIBRARY_DIR;
  }
  if (source === "downloads") {
    return DOWNLOADS_DIR;
  }
  throw new Error("Unknown track source.");
}

function resolveTrackPath(id) {
  const { source, relativePath } = decodeTrackId(id);
  const root = getRootForSource(source);
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolutePath = path.resolve(root, safePath);

  if (!absolutePath.startsWith(root)) {
    throw new Error("Track path rejected.");
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error("Track not found.");
  }

  return absolutePath;
}

function streamTrack(req, res, trackId) {
  let absolutePath;
  try {
    absolutePath = resolveTrackPath(trackId);
  } catch (error) {
    return sendJson(res, 404, { error: error.message });
  }

  const stats = fs.statSync(absolutePath);
  const contentType = getContentType(absolutePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(absolutePath).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    return sendText(res, 416, "Invalid range.");
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stats.size - 1;

  if (start >= stats.size || end >= stats.size || start > end) {
    return sendText(res, 416, "Range not satisfiable.", {
      "Content-Range": `bytes */${stats.size}`
    });
  }

  res.writeHead(206, {
    "Content-Type": contentType,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes ${start}-${end}/${stats.size}`
  });
  fs.createReadStream(absolutePath, { start, end }).pipe(res);
}

function getContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".aac":
      return "audio/aac";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function serveStaticAsset(res, requestPath) {
  const normalized = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const assetPath = path.resolve(PUBLIC_DIR, normalized);

  if (!assetPath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden.");
  }

  if (!fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    const html = fs.readFileSync(fallback);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    "Content-Type": getContentType(assetPath)
  });
  fs.createReadStream(assetPath).pipe(res);
}

function queueDownload(res, body) {
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return sendJson(res, 400, { error: "A Spotify or YouTube URL is required." });
  }

  const existingDownloads = getAudioFileSnapshot(DOWNLOADS_DIR);

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    url,
    status: "queued",
    startedAt: new Date().toISOString(),
    output: [],
    error: null,
    driveSync: {
      status: "pending",
      uploadedFiles: []
    }
  };

  downloadJobs.set(jobId, job);
  const outputTemplate = path.join(DOWNLOADS_DIR, "{artist} - {title}.{output-ext}");
  const child = spawn(SPOTDL_BIN, [url, "--output", outputTemplate], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });

  job.status = "running";

  child.stdout.on("data", (chunk) => {
    job.output.push(chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk) => {
    job.output.push(chunk.toString("utf8"));
  });

  child.on("error", (error) => {
    job.status = "failed";
    job.error =
      error.code === "ENOENT"
        ? `Could not find '${SPOTDL_BIN}'. Install spotdl or point SPOTDL_BIN at the executable.`
        : error.message;
  });

  child.on("close", async (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = "completed";
      try {
        const newFiles = getChangedAudioFiles(DOWNLOADS_DIR, existingDownloads);
        if (newFiles.length === 0) {
          job.driveSync = {
            status: "skipped",
            uploadedFiles: [],
            message: "No new audio files were detected for Drive sync."
          };
          return;
        }

        const syncResult = await syncFilesToHereNowDrive(newFiles);
        job.driveSync = {
          status: "completed",
          uploadedFiles: syncResult.uploadedFiles,
          driveId: syncResult.driveId,
          driveName: syncResult.driveName
        };
      } catch (error) {
        job.driveSync = {
          status: "failed",
          uploadedFiles: [],
          error: error.message
        };
      }
      return;
    }

    job.status = "failed";
    if (!job.error) {
      job.error = `spotdl exited with code ${code}.`;
    }
  });

  return sendJson(res, 202, {
    message: "Download queued.",
    job
  });
}

function listAudioFiles(rootDir) {
  const files = [];
  walkAudioFiles(rootDir, (absolutePath) => {
    files.push(absolutePath);
  });
  return files.sort();
}

function getAudioFileSnapshot(rootDir) {
  const snapshot = new Map();
  walkAudioFiles(rootDir, (absolutePath) => {
    const stats = fs.statSync(absolutePath);
    snapshot.set(absolutePath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs
    });
  });
  return snapshot;
}

function getChangedAudioFiles(rootDir, previousSnapshot) {
  const changedFiles = [];
  walkAudioFiles(rootDir, (absolutePath) => {
    const stats = fs.statSync(absolutePath);
    const previous = previousSnapshot.get(absolutePath);
    if (!previous || previous.size !== stats.size || previous.mtimeMs !== stats.mtimeMs) {
      changedFiles.push(absolutePath);
    }
  });
  return changedFiles.sort();
}

async function syncFilesToHereNowDrive(filePaths, options = {}) {
  const apiKey = getHereNowApiKey();
  if (!apiKey) {
    throw new Error("here.now credentials are not configured.");
  }

  const defaultDriveResponse = await hereNowJson("GET", "https://here.now/api/v1/drives/default", apiKey);
  const driveId = defaultDriveResponse?.drive?.id;
  const driveName = defaultDriveResponse?.drive?.name || "My Drive";
  if (!driveId) {
    throw new Error("Could not resolve the default here.now Drive.");
  }

  const sourceRoot = options.rootDir || DOWNLOADS_DIR;
  const drivePrefix = options.drivePrefix || "downloads";
  const uploadedFiles = [];
  for (const filePath of filePaths) {
    const relativePath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
    const drivePath = `${drivePrefix}/${relativePath}`;
    const uploadResult = await uploadFileToHereNowDrive(apiKey, driveId, drivePath, filePath);
    uploadedFiles.push({
      localPath: relativePath,
      drivePath,
      etag: uploadResult.etag || null
    });
  }

  return {
    driveId,
    driveName,
    uploadedFiles
  };
}

function getHereNowApiKey() {
  if (process.env.HERENOW_API_KEY?.trim()) {
    return process.env.HERENOW_API_KEY.trim();
  }

  if (fs.existsSync(HERENOW_CREDENTIALS_PATH)) {
    return fs.readFileSync(HERENOW_CREDENTIALS_PATH, "utf8").trim();
  }

  return "";
}

async function uploadFileToHereNowDrive(apiKey, driveId, drivePath, filePath) {
  const stats = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const contentType = getContentType(filePath);
  const existingFile = await findHereNowDriveFile(apiKey, driveId, drivePath);

  const body = {
    path: drivePath,
    size: stats.size,
    contentType,
    sha256
  };

  if (existingFile?.etag) {
    body.ifMatch = existingFile.etag;
  } else {
    body.ifNoneMatch = "*";
  }

  const upload = await hereNowJson(
    "POST",
    `https://here.now/api/v1/drives/${driveId}/files/uploads`,
    apiKey,
    body
  );

  const fileBuffer = fs.readFileSync(filePath);
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType
    },
    body: fileBuffer
  });

  if (!uploadResponse.ok) {
    throw new Error(`Drive upload failed for ${drivePath}: HTTP ${uploadResponse.status}.`);
  }

  return hereNowJson(
    "POST",
    `https://here.now/api/v1/drives/${driveId}/files/finalize`,
    apiKey,
    { uploadId: upload.uploadId }
  );
}

async function findHereNowDriveFile(apiKey, driveId, drivePath) {
  const prefix = encodeURIComponent(drivePath);
  const response = await hereNowJson(
    "GET",
    `https://here.now/api/v1/drives/${driveId}/files?prefix=${prefix}&limit=200`,
    apiKey
  );
  return (response.files || []).find((file) => file.path === drivePath) || null;
}

async function hereNowJson(method, url, apiKey, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `here.now request failed with HTTP ${response.status}.`);
  }

  return payload;
}

function isSpotifyConfigured() {
  return isConfiguredSpotifyValue(spotifyConfig.clientId) && isConfiguredSpotifyValue(spotifyConfig.clientSecret);
}

function isConfiguredSpotifyValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !normalized.startsWith("your_spotify_");
}

function getRequestOrigin(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" && forwardedProto ? forwardedProto.split(",")[0].trim() : "http";
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  return `${protocol}://${host}`;
}

function getSpotifyRedirectUri(req) {
  if (spotifyConfig.redirectUri) {
    return spotifyConfig.redirectUri;
  }
  return `${getRequestOrigin(req)}/api/spotify/callback`;
}

function startSpotifyLogin(req, res) {
  if (!isSpotifyConfigured()) {
    return sendJson(res, 400, {
      error: "Spotify credentials are not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env first."
    });
  }

  const redirectUri = getSpotifyRedirectUri(req);
  const state = crypto.randomUUID();
  stateStore.set(state, {
    createdAt: Date.now(),
    redirectUri
  });
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", spotifyConfig.clientId);
  authUrl.searchParams.set("scope", spotifyConfig.scopes);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  res.writeHead(302, {
    Location: authUrl.toString()
  });
  res.end();
}

async function handleSpotifyCallback(req, res, parsedUrl) {
  const code = parsedUrl.searchParams.get("code");
  const state = parsedUrl.searchParams.get("state");
  const error = parsedUrl.searchParams.get("error");

  if (error) {
    return redirectHome(res, `spotify_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !stateStore.has(state)) {
    return redirectHome(res, "spotify_error=invalid_callback");
  }

  const loginState = stateStore.get(state);
  stateStore.delete(state);

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${spotifyConfig.clientId}:${spotifyConfig.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: loginState.redirectUri || getSpotifyRedirectUri(req)
    })
  });

  const payload = await tokenResponse.json();
  if (!tokenResponse.ok) {
    return redirectHome(res, `spotify_error=${encodeURIComponent(payload.error_description || payload.error || "token_exchange_failed")}`);
  }

  const sessionId = createSession(payload);
  res.writeHead(302, {
    Location: "/?spotify=connected",
    "Set-Cookie": buildCookie("retro_session", signValue(sessionId), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7
    })
  });
  res.end();
}

function logoutSpotify(req, res) {
  const sessionId = getVerifiedSessionId(req);
  if (sessionId) {
    sessionStore.delete(sessionId);
  }

  sendJson(
    res,
    200,
    { ok: true },
    {
      "Set-Cookie": buildCookie("retro_session", "", {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 0
      })
    }
  );
}

async function getSpotifyStatus(req, res) {
  const session = await requireSpotifySession(req, res, false);
  if (!session) {
    return sendJson(res, 200, {
      configured: isSpotifyConfigured(),
      connected: false
    });
  }

  return sendJson(res, 200, {
    configured: isSpotifyConfigured(),
    connected: true,
    expiresAt: session.expiresAt
  });
}

async function proxySpotifyRequest(req, res, targetUrl) {
  const session = await requireSpotifySession(req, res, true);
  if (!session) {
    return;
  }

  const response = await spotifyApiFetch(session, targetUrl);
  const payload = await response.json();
  if (!response.ok) {
    return sendJson(res, response.status, {
      error: payload.error?.message || payload.error || "Spotify request failed."
    });
  }

  return sendJson(res, 200, payload);
}

function createSession(tokenPayload) {
  const sessionId = crypto.randomUUID();
  sessionStore.set(sessionId, {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt: Date.now() + (tokenPayload.expires_in || 3600) * 1000
  });
  return sessionId;
}

async function requireSpotifySession(req, res, sendFailure) {
  if (!isSpotifyConfigured()) {
    if (sendFailure) {
      sendJson(res, 400, {
        error: "Spotify is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env."
      });
    }
    return null;
  }

  const sessionId = getVerifiedSessionId(req);
  if (!sessionId || !sessionStore.has(sessionId)) {
    if (sendFailure) {
      sendJson(res, 401, {
        error: "Spotify account is not connected."
      });
    }
    return null;
  }

  const session = sessionStore.get(sessionId);
  if (Date.now() >= session.expiresAt - 30000) {
    const refreshed = await refreshSpotifySession(session);
    if (!refreshed) {
      sessionStore.delete(sessionId);
      if (sendFailure) {
        sendJson(res, 401, {
          error: "Spotify session expired. Reconnect your account."
        });
      }
      return null;
    }
  }

  return session;
}

async function refreshSpotifySession(session) {
  if (!session.refreshToken) {
    return false;
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${spotifyConfig.clientId}:${spotifyConfig.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    return false;
  }

  session.accessToken = payload.access_token;
  session.expiresAt = Date.now() + (payload.expires_in || 3600) * 1000;
  if (payload.refresh_token) {
    session.refreshToken = payload.refresh_token;
  }
  return true;
}

async function spotifyApiFetch(session, url) {
  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });

  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshSpotifySession(session);
  if (!refreshed) {
    return response;
  }

  response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });
  return response;
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const equalsIndex = part.indexOf("=");
      if (equalsIndex === -1) {
        return accumulator;
      }
      const key = part.slice(0, equalsIndex);
      const value = part.slice(equalsIndex + 1);
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

function signValue(value) {
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
  return `${value}.${signature}`;
}

function verifySignedValue(signedValue) {
  const separatorIndex = signedValue.lastIndexOf(".");
  if (separatorIndex === -1) {
    return null;
  }

  const rawValue = signedValue.slice(0, separatorIndex);
  const signature = signedValue.slice(separatorIndex + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(rawValue)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }
  return rawValue;
}

function getVerifiedSessionId(req) {
  const cookies = parseCookies(req);
  const signedSession = cookies.retro_session;
  if (!signedSession) {
    return null;
  }
  return verifySignedValue(signedSession);
}

function redirectHome(res, search = "") {
  const location = search ? `/?${search}` : "/";
  res.writeHead(302, {
    Location: location
  });
  res.end();
}
