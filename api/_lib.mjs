import crypto from "node:crypto";
import path from "node:path";

const audioExtensions = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const drivePrefixBySource = {
  library: "library",
  downloads: "downloads"
};

const spotifyCookieName = "thelittlecave_spotify";
const stateTtlMs = 10 * 60 * 1000;

export function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

export function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders
    }
  });
}

export function getAppConfig(request) {
  return {
    backendAvailable: true,
    hostingMode: "vercel",
    spotifyConfigured: isSpotifyConfigured(),
    spotifyRedirectUri: getSpotifyRedirectUri(request),
    storageConfigured: Boolean(getHereNowApiKey()),
    downloadSupported: false,
    libraryFolders: ["library", "downloads"],
    spotdl: {
      configuredBin: null
    }
  };
}

export function getHereNowApiKey() {
  return process.env.HERENOW_API_KEY?.trim() || "";
}

export async function listLibraryTracks() {
  const apiKey = getHereNowApiKey();
  if (!apiKey) {
    return [];
  }

  const drive = await getDefaultDrive(apiKey);
  const files = [];
  for (const [source, prefix] of Object.entries(drivePrefixBySource)) {
    const driveFiles = await listDriveFiles(apiKey, drive.id, prefix);
    for (const file of driveFiles) {
      const track = buildTrackRecord(source, file);
      if (track) {
        files.push(track);
      }
    }
  }

  return files.sort((a, b) => a.title.localeCompare(b.title));
}

export function resolveImportPath(relativePathHeader, fileNameHeader) {
  const requestedPath = decodeURIComponent(relativePathHeader || fileNameHeader || "").replace(/\\/g, "/");
  const fallbackName = decodeURIComponent(fileNameHeader || "upload.bin");
  const chosenPath = requestedPath || fallbackName;
  const normalizedPath = path.posix.normalize(chosenPath).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath === "." || normalizedPath.endsWith("/")) {
    throw new Error("Invalid import path.");
  }

  if (!audioExtensions.has(path.posix.extname(normalizedPath).toLowerCase())) {
    throw new Error("Only supported audio files can be imported.");
  }

  return normalizedPath;
}

export async function importTrackToDrive(relativePath, fileBuffer, contentType) {
  const apiKey = getHereNowApiKey();
  if (!apiKey) {
    throw new Error("here.now Drive storage is not configured on this deployment.");
  }

  const drive = await getDefaultDrive(apiKey);
  const drivePath = `library/${relativePath}`;
  const finalizeResult = await uploadFileToDrive(apiKey, drive.id, drivePath, fileBuffer, contentType);

  return {
    track: buildTrackRecord("library", {
      path: drivePath,
      size: fileBuffer.length,
      updatedAt: new Date().toISOString()
    }),
    driveSync: {
      status: "completed",
      driveId: drive.id,
      driveName: drive.name,
      uploadedFiles: [
        {
          localPath: relativePath,
          drivePath,
          etag: finalizeResult?.etag || null
        }
      ]
    }
  };
}

export async function getTrackStream(trackId, request) {
  const apiKey = getHereNowApiKey();
  if (!apiKey) {
    throw new Error("here.now Drive storage is not configured on this deployment.");
  }

  const drive = await getDefaultDrive(apiKey);
  const { source, relativePath } = decodeTrackId(trackId);
  const prefix = drivePrefixBySource[source];
  if (!prefix) {
    throw new Error("Unknown track source.");
  }

  const drivePath = `${prefix}/${relativePath}`;
  const encodedPath = drivePath.split("/").map((part) => encodeURIComponent(part)).join("/");
  const range = request.headers.get("range");
  const response = await fetch(`https://here.now/api/v1/drives/${drive.id}/files/${encodedPath}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(range ? { Range: range } : {})
    }
  });

  if (response.status === 404) {
    throw new Error("Track not found.");
  }
  if (!response.ok) {
    const detail = await safeJson(response);
    throw new Error(detail?.error || `Drive stream failed with HTTP ${response.status}.`);
  }

  const headers = new Headers();
  copyHeader(response.headers, headers, "content-type");
  copyHeader(response.headers, headers, "content-length");
  copyHeader(response.headers, headers, "content-range");
  copyHeader(response.headers, headers, "accept-ranges");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

export function isSpotifyConfigured() {
  return isConfiguredSpotifyValue(process.env.SPOTIFY_CLIENT_ID) && isConfiguredSpotifyValue(process.env.SPOTIFY_CLIENT_SECRET);
}

function isConfiguredSpotifyValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !normalized.startsWith("your_spotify_");
}

export function getSpotifyRedirectUri(request) {
  if (process.env.SPOTIFY_REDIRECT_URI?.trim()) {
    return process.env.SPOTIFY_REDIRECT_URI.trim();
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/spotify/callback`;
}

export function createSpotifyLoginUrl(request) {
  const redirectUri = getSpotifyRedirectUri(request);
  const state = encryptValue(
    JSON.stringify({
      redirectUri,
      createdAt: Date.now()
    })
  );
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", process.env.SPOTIFY_CLIENT_ID || "");
  authUrl.searchParams.set("scope", process.env.SPOTIFY_SCOPES || "");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

export async function exchangeSpotifyCode(code, encryptedState) {
  const parsedState = parseSpotifyState(encryptedState);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: parsedState.redirectUri
    })
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.error || "Spotify token exchange failed.");
  }

  return createSpotifySessionCookie({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000
  });
}

export async function getSpotifySession(request) {
  const cookieValue = getCookie(request, spotifyCookieName);
  if (!cookieValue) {
    return null;
  }

  let session;
  try {
    session = JSON.parse(decryptValue(cookieValue));
  } catch {
    return null;
  }

  if (!session?.accessToken || !session?.refreshToken) {
    return null;
  }

  if (Date.now() < Number(session.expiresAt || 0) - 30000) {
    return {
      session,
      setCookie: null
    };
  }

  const refreshed = await refreshSpotifySession(session.refreshToken);
  return {
    session: refreshed,
    setCookie: createSpotifySessionCookie(refreshed)
  };
}

export async function spotifyApiRequest(request, targetUrl) {
  const sessionResult = await getSpotifySession(request);
  if (!sessionResult) {
    return {
      response: json({ error: "Spotify account is not connected." }, 401),
      setCookie: null
    };
  }

  let response = await fetch(targetUrl, {
    headers: {
      Authorization: `Bearer ${sessionResult.session.accessToken}`
    }
  });

  if (response.status === 401) {
    const refreshed = await refreshSpotifySession(sessionResult.session.refreshToken);
    response = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${refreshed.accessToken}`
      }
    });
    return {
      response,
      setCookie: createSpotifySessionCookie(refreshed)
    };
  }

  return {
    response,
    setCookie: sessionResult.setCookie
  };
}

export function clearSpotifySessionCookie(request) {
  return serializeCookie(spotifyCookieName, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(request),
    maxAge: 0
  });
}

export function createSpotifySessionCookie(session) {
  return serializeCookie(spotifyCookieName, encryptValue(JSON.stringify(session)), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 7
  });
}

async function refreshSpotifySession(refreshToken) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.error || "Spotify refresh failed.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000
  };
}

function parseSpotifyState(encryptedState) {
  const parsed = JSON.parse(decryptValue(encryptedState || ""));
  if (!parsed?.redirectUri || !parsed?.createdAt) {
    throw new Error("Invalid Spotify OAuth state.");
  }
  if (Date.now() - Number(parsed.createdAt) > stateTtlMs) {
    throw new Error("Spotify OAuth state expired.");
  }
  return parsed;
}

function getSessionKey() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is required for hosted Spotify auth.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function decryptValue(token) {
  const payload = Buffer.from(token, "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getSessionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex);
    if (key !== name) {
      continue;
    }
    return decodeURIComponent(trimmed.slice(separatorIndex + 1));
  }
  return "";
}

function serializeCookie(name, value, options = {}) {
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
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function isSecureRequest(request) {
  const url = new URL(request.url);
  return url.protocol === "https:";
}

async function getDefaultDrive(apiKey) {
  if (process.env.HERENOW_DRIVE_ID?.trim()) {
    return {
      id: process.env.HERENOW_DRIVE_ID.trim(),
      name: process.env.HERENOW_DRIVE_NAME?.trim() || "Configured Drive"
    };
  }

  const response = await hereNowJson("GET", "https://here.now/api/v1/drives/default", apiKey);
  return {
    id: response.drive.id,
    name: response.drive.name || "My Drive"
  };
}

async function listDriveFiles(apiKey, driveId, prefix) {
  const files = [];
  let cursor = "";

  while (true) {
    const query = new URLSearchParams();
    query.set("prefix", prefix);
    query.set("limit", "200");
    if (cursor) {
      query.set("cursor", cursor);
    }
    const response = await hereNowJson(
      "GET",
      `https://here.now/api/v1/drives/${driveId}/files?${query.toString()}`,
      apiKey
    );
    files.push(...(response.files || []));
    if (!response.nextCursor) {
      break;
    }
    cursor = response.nextCursor;
  }

  return files;
}

function buildTrackRecord(source, driveFile) {
  const prefix = drivePrefixBySource[source];
  if (!prefix) {
    return null;
  }
  const relativePath = String(driveFile.path || "").startsWith(`${prefix}/`)
    ? String(driveFile.path).slice(prefix.length + 1)
    : String(driveFile.path || "");
  if (!relativePath || !audioExtensions.has(path.posix.extname(relativePath).toLowerCase())) {
    return null;
  }

  const id = Buffer.from(`${source}:${relativePath}`, "utf8").toString("base64url");
  return {
    id,
    source,
    title: path.posix.basename(relativePath, path.posix.extname(relativePath)),
    relativePath,
    size: Number(driveFile.size || 0),
    updatedAt: driveFile.updatedAt || driveFile.modifiedAt || new Date().toISOString(),
    url: `/api/stream/${id}`
  };
}

function decodeTrackId(trackId) {
  const decoded = Buffer.from(trackId, "base64url").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    throw new Error("Invalid track identifier.");
  }

  return {
    source: decoded.slice(0, separator),
    relativePath: decoded.slice(separator + 1)
  };
}

async function uploadFileToDrive(apiKey, driveId, drivePath, fileBuffer, contentType) {
  const existingFile = await findDriveFile(apiKey, driveId, drivePath);
  const body = {
    path: drivePath,
    size: fileBuffer.length,
    contentType: contentType || getContentType(drivePath),
    sha256: crypto.createHash("sha256").update(fileBuffer).digest("hex")
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

  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": body.contentType
    },
    body: fileBuffer
  });

  if (!uploadResponse.ok) {
    throw new Error(`Drive upload failed with HTTP ${uploadResponse.status}.`);
  }

  return hereNowJson(
    "POST",
    `https://here.now/api/v1/drives/${driveId}/files/finalize`,
    apiKey,
    { uploadId: upload.uploadId }
  );
}

async function findDriveFile(apiKey, driveId, drivePath) {
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
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || `here.now request failed with HTTP ${response.status}.`);
  }
  return payload;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
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
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function copyHeader(from, to, name) {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}
