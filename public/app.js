const themePresets = {
  monochromeDefault: {
    label: "thelittlecave Default",
    colors: {
      bg: "#fdfcfc",
      panel: "#fdfcfc",
      panel2: "#f8f7f7",
      accent: "#201d1d",
      glow: "#302c2c",
      text: "#201d1d",
      muted: "#646262",
      border: "rgba(15, 0, 0, 0.12)",
      borderStrong: "#646262",
      surfaceCard: "#f1eeee",
      surfaceDark: "#201d1d",
      surfaceDarkElevated: "#302c2c"
    }
  },
  paperSignal: {
    label: "Paper Signal",
    colors: {
      bg: "#fcfbf8",
      panel: "#fcfbf8",
      panel2: "#f3f0ea",
      accent: "#171513",
      glow: "#4a443f",
      text: "#171513",
      muted: "#736c65",
      border: "rgba(23, 21, 19, 0.12)",
      borderStrong: "#736c65",
      surfaceCard: "#ece7df",
      surfaceDark: "#171513",
      surfaceDarkElevated: "#2f2a26"
    }
  },
  slateManual: {
    label: "Slate Manual",
    colors: {
      bg: "#f7f7f8",
      panel: "#f7f7f8",
      panel2: "#efeff1",
      accent: "#1e1f24",
      glow: "#3b3d46",
      text: "#1e1f24",
      muted: "#666974",
      border: "rgba(30, 31, 36, 0.12)",
      borderStrong: "#666974",
      surfaceCard: "#e7e7eb",
      surfaceDark: "#1e1f24",
      surfaceDarkElevated: "#343742"
    }
  }
};

const availableViews = ["overview", "player", "library", "downloads", "spotify", "settings"];

const state = {
  backendAvailable: true,
  storageConfigured: false,
  downloadSupported: false,
  hostingMode: "local",
  tracks: [],
  filteredTracks: [],
  currentIndex: -1,
  shuffle: false,
  spotifyConfigured: false,
  spotifyConnected: false,
  activeTheme: localStorage.getItem("retro-theme") || "monochromeDefault",
  themeOverrides: loadThemeOverrides(),
  activeView: "overview"
};

const audio = document.querySelector("#audio-player");
const libraryList = document.querySelector("#library-list");
const libraryMessage = document.querySelector("#library-message");
const nowPlayingTitle = document.querySelector("#now-playing-title");
const nowPlayingMeta = document.querySelector("#now-playing-meta");
const playPauseButton = document.querySelector("#play-pause");
const prevButton = document.querySelector("#prev-track");
const nextButton = document.querySelector("#next-track");
const seekbar = document.querySelector("#seekbar");
const currentTimeLabel = document.querySelector("#current-time");
const durationLabel = document.querySelector("#duration");
const volumeSlider = document.querySelector("#volume");
const shuffleToggle = document.querySelector("#shuffle-toggle");
const trackFilter = document.querySelector("#track-filter");
const fileImport = document.querySelector("#file-import");
const folderImport = document.querySelector("#folder-import");
const refreshLibraryButton = document.querySelector("#refresh-library");
const themeSelect = document.querySelector("#theme-select");
const themePickers = document.querySelector("#theme-pickers");
const resetThemeButton = document.querySelector("#reset-theme");
const downloadUrlInput = document.querySelector("#download-url");
const downloadTrackButton = document.querySelector("#download-track");
const downloadMessage = document.querySelector("#download-message");
const downloadJobs = document.querySelector("#download-jobs");
const spotifyConnectButton = document.querySelector("#spotify-connect");
const spotifyLogoutButton = document.querySelector("#spotify-logout");
const spotifyAccount = document.querySelector("#spotify-account");
const spotifyPlaylists = document.querySelector("#spotify-playlists");
const spotifyRecent = document.querySelector("#spotify-recent");
const spotifySearchResults = document.querySelector("#spotify-search-results");
const spotifySearchInput = document.querySelector("#spotify-search-input");
const spotifySearchButton = document.querySelector("#spotify-search-button");
const connectionPill = document.querySelector("#connection-pill");
const libraryCount = document.querySelector("#library-count");
const downloadCount = document.querySelector("#download-count");
const spotifySummary = document.querySelector("#spotify-summary");
const activeThemeLabel = document.querySelector("#active-theme-label");
const viewButtons = Array.from(document.querySelectorAll("[data-view-target]"));
const jumpButtons = Array.from(document.querySelectorAll("[data-jump-view]"));
const viewLinks = Array.from(document.querySelectorAll("[data-view-link]"));
const viewSections = Array.from(document.querySelectorAll(".view-section"));

bootstrap();

async function bootstrap() {
  populateThemeSelect();
  applyTheme();
  wireEvents();
  audio.volume = Number(volumeSlider.value);
  syncViewFromLocation();
  await loadConfig();
  if (state.backendAvailable) {
    await Promise.all([loadLibrary(), loadSpotifyStatus(), loadDownloads()]);
  } else {
    renderBackendUnavailableState();
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("spotify") || params.get("spotify_error")) {
    const hash = window.location.hash || "#overview";
    window.history.replaceState({}, "", `${hash}`);
  }
  syncOverview();
}

function wireEvents() {
  playPauseButton.addEventListener("click", togglePlayback);
  prevButton.addEventListener("click", playPrevious);
  nextButton.addEventListener("click", playNext);
  volumeSlider.addEventListener("input", () => {
    audio.volume = Number(volumeSlider.value);
  });
  seekbar.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration)) {
      return;
    }
    audio.currentTime = (Number(seekbar.value) / 100) * audio.duration;
  });
  audio.addEventListener("timeupdate", syncTimeline);
  audio.addEventListener("loadedmetadata", syncTimeline);
  audio.addEventListener("play", () => {
    playPauseButton.textContent = "Pause";
    document.body.dataset.playing = "true";
  });
  audio.addEventListener("pause", () => {
    playPauseButton.textContent = "Play";
    document.body.dataset.playing = "false";
  });
  audio.addEventListener("ended", () => {
    playNext();
  });
  trackFilter.addEventListener("input", renderLibrary);
  shuffleToggle.addEventListener("change", () => {
    state.shuffle = shuffleToggle.checked;
  });
  fileImport.addEventListener("change", (event) => importFiles(event.target.files, event.target));
  folderImport.addEventListener("change", (event) => importFiles(event.target.files, event.target));
  refreshLibraryButton.addEventListener("click", loadLibrary);
  themeSelect.addEventListener("change", () => {
    state.activeTheme = themeSelect.value;
    localStorage.setItem("retro-theme", state.activeTheme);
    renderThemePickers();
    applyTheme();
    syncOverview();
  });
  resetThemeButton.addEventListener("click", resetActiveTheme);
  downloadTrackButton.addEventListener("click", submitDownload);
  spotifyConnectButton.addEventListener("click", () => {
    if (!state.backendAvailable) {
      libraryMessage.textContent = "Spotify connect is only available from the local app server.";
      return;
    }
    window.location.href = "/api/spotify/login";
  });
  spotifyLogoutButton.addEventListener("click", disconnectSpotify);
  spotifySearchButton.addEventListener("click", runSpotifySearch);
  spotifySearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSpotifySearch();
    }
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.viewTarget);
    });
  });

  jumpButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.jumpView);
    });
  });

  viewLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setView(link.dataset.viewLink);
    });
  });

  window.addEventListener("hashchange", syncViewFromLocation);
}

function syncViewFromLocation() {
  const requestedView = window.location.hash.replace(/^#/, "");
  if (availableViews.includes(requestedView)) {
    setView(requestedView, false);
    return;
  }
  setView("overview", false);
}

function setView(view, updateHash = true) {
  const safeView = availableViews.includes(view) ? view : "overview";
  state.activeView = safeView;
  document.body.dataset.view = safeView;

  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === safeView);
  });

  viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === safeView);
  });

  if (updateHash) {
    window.location.hash = safeView;
  }
}

async function loadConfig() {
  let response;
  let payload;
  try {
    response = await fetch("/api/config");
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("Backend config route is unavailable.");
    }
    payload = await response.json();
  } catch (error) {
    state.backendAvailable = false;
    spotifyConnectButton.disabled = true;
    downloadTrackButton.disabled = true;
    refreshLibraryButton.disabled = true;
    fileImport.disabled = true;
    folderImport.disabled = true;
    libraryMessage.textContent =
      "This published site does not include the local backend. Use http://127.0.0.1:4310 for Spotify, downloads, and persistent imports.";
    spotifyAccount.innerHTML =
      `<p class="meta-text">Spotify login requires the local app server. Open <code>http://127.0.0.1:4310</code> to use account features.</p>`;
    downloadMessage.textContent =
      "Downloads require the local app server. Open http://127.0.0.1:4310 to queue spotdl jobs.";
    syncOverview();
    return;
  }

  state.backendAvailable = true;
  state.storageConfigured = Boolean(payload.storageConfigured);
  state.downloadSupported = Boolean(payload.downloadSupported);
  state.hostingMode = payload.hostingMode || "local";
  state.spotifyConfigured = payload.spotifyConfigured;
  spotifyConnectButton.disabled = !payload.spotifyConfigured;
  fileImport.disabled = !state.storageConfigured;
  folderImport.disabled = !state.storageConfigured;
  refreshLibraryButton.disabled = false;
  downloadTrackButton.disabled = !state.downloadSupported;

  if (!payload.spotifyConfigured) {
    spotifyAccount.innerHTML =
      state.hostingMode === "vercel"
        ? `<p class="meta-text">Spotify is not configured on this Vercel deployment yet. Add <code>SPOTIFY_CLIENT_ID</code>, <code>SPOTIFY_CLIENT_SECRET</code>, and <code>SESSION_SECRET</code> in Vercel project settings. Redirect URI: <code>${payload.spotifyRedirectUri}</code>.</p>`
        : `<p class="meta-text">Spotify is not configured yet. Copy <code>.env.example</code> to <code>.env</code> and fill in your own app credentials. Redirect URI: <code>${payload.spotifyRedirectUri}</code>.</p>`;
  }

  if (!state.storageConfigured) {
    libraryMessage.textContent =
      "Persistent library storage is not configured on this deployment. Set HERENOW_API_KEY in Vercel.";
  } else if (!libraryMessage.textContent) {
    libraryMessage.textContent =
      state.hostingMode === "vercel"
        ? "Uploads are saved to cloud storage and persist across refreshes."
        : "";
  }

  if (!state.downloadSupported) {
    downloadMessage.textContent =
      state.hostingMode === "vercel"
        ? "Hosted downloads are disabled on Vercel. Use the library upload flow instead."
        : downloadMessage.textContent;
  }

  syncOverview();
}

async function loadLibrary() {
  const response = await fetch("/api/library");
  const payload = await response.json();
  state.tracks = payload.tracks || [];
  renderLibrary();
}

async function importFiles(fileList, inputElement) {
  if (!state.backendAvailable) {
    libraryMessage.textContent =
      "Persistent imports require the local app server at http://127.0.0.1:4310.";
    if (inputElement) {
      inputElement.value = "";
    }
    return;
  }

  if (!state.storageConfigured) {
    libraryMessage.textContent =
      "Persistent imports are unavailable until HERENOW_API_KEY is configured on the deployment.";
    if (inputElement) {
      inputElement.value = "";
    }
    return;
  }

  const files = Array.from(fileList || []).filter(
    (file) => file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)
  );
  if (files.length === 0) {
    libraryMessage.textContent = "Select at least one supported audio file.";
    if (inputElement) {
      inputElement.value = "";
    }
    return;
  }

  libraryMessage.textContent = `Importing ${files.length} file${files.length === 1 ? "" : "s"}...`;
  let importedCount = 0;

  for (const file of files) {
    const response = await fetch("/api/library/import", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Relative-Path": encodeURIComponent(file.webkitRelativePath || file.name)
      },
      body: file
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      libraryMessage.textContent =
        payload.error || `Failed to import ${file.name}. The file was not saved.`;
      if (inputElement) {
        inputElement.value = "";
      }
      await loadLibrary();
      return;
    }

    importedCount += 1;
  }

  libraryMessage.textContent = `Imported ${importedCount} file${importedCount === 1 ? "" : "s"} into the library.`;
  if (inputElement) {
    inputElement.value = "";
  }
  await loadLibrary();
}

function renderLibrary() {
  const filterValue = trackFilter.value.trim().toLowerCase();
  state.filteredTracks = state.tracks.filter((track) => {
    const haystack = `${track.title} ${track.source} ${track.relativePath}`.toLowerCase();
    return haystack.includes(filterValue);
  });

  libraryCount.textContent = String(state.filteredTracks.length);

  if (state.filteredTracks.length === 0) {
    libraryList.innerHTML = `<div class="track-card"><p class="meta-text">No tracks match the current filter.</p></div>`;
    syncOverview();
    return;
  }

  libraryList.innerHTML = state.filteredTracks
    .map((track, index) => {
      const badgeClass = track.source === "downloads" ? "downloads" : track.source;
      return `
        <article class="track-card">
          <div class="track-row">
            <div>
              <strong>${escapeHtml(track.title)}</strong>
              <div class="track-meta">${escapeHtml(track.relativePath)}</div>
            </div>
            <span class="badge ${badgeClass}">${escapeHtml(track.source)}</span>
          </div>
          <div class="track-row">
            <span class="track-meta">${formatBytes(track.size)}</span>
            <button class="button-secondary" data-play-index="${index}">Play</button>
          </div>
        </article>
      `;
    })
    .join("");

  libraryList.querySelectorAll("[data-play-index]").forEach((button) => {
    button.addEventListener("click", () => {
      playTrackByIndex(Number(button.dataset.playIndex));
      setView("player");
    });
  });

  syncOverview();
}

function playTrackByIndex(index) {
  const track = state.filteredTracks[index];
  if (!track) {
    return;
  }

  state.currentIndex = index;
  audio.src = track.url;
  audio.play();
  nowPlayingTitle.textContent = track.title;
  nowPlayingMeta.textContent = `${track.source.toUpperCase()} | ${track.relativePath}`;
}

function togglePlayback() {
  if (!audio.src && state.filteredTracks.length > 0) {
    playTrackByIndex(0);
    return;
  }

  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

function playPrevious() {
  if (state.filteredTracks.length === 0) {
    return;
  }
  const index = state.currentIndex <= 0 ? state.filteredTracks.length - 1 : state.currentIndex - 1;
  playTrackByIndex(index);
}

function playNext() {
  if (state.filteredTracks.length === 0) {
    return;
  }

  if (state.shuffle) {
    const index = Math.floor(Math.random() * state.filteredTracks.length);
    playTrackByIndex(index);
    return;
  }

  const index =
    state.currentIndex >= state.filteredTracks.length - 1 ? 0 : state.currentIndex + 1;
  playTrackByIndex(index);
}

function syncTimeline() {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    seekbar.value = 0;
    currentTimeLabel.textContent = "0:00";
    durationLabel.textContent = "0:00";
    return;
  }

  seekbar.value = String((audio.currentTime / audio.duration) * 100);
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  durationLabel.textContent = formatTime(audio.duration);
}

function populateThemeSelect() {
  themeSelect.innerHTML = Object.entries(themePresets)
    .map(([key, theme]) => `<option value="${key}">${theme.label}</option>`)
    .join("");
  if (!themePresets[state.activeTheme]) {
    state.activeTheme = "monochromeDefault";
  }
  themeSelect.value = state.activeTheme;
  renderThemePickers();
}

function renderThemePickers() {
  const theme = getActiveTheme();
  themePickers.innerHTML = Object.entries(theme.colors)
    .map(
      ([token, value]) => `
        <label class="picker-card">
          <span>${escapeHtml(token)}</span>
          <input type="color" value="${colorInputValue(value)}" data-token="${token}" />
        </label>
      `
    )
    .join("");

  themePickers.querySelectorAll("input[type='color']").forEach((input) => {
    input.addEventListener("input", () => {
      if (!state.themeOverrides[state.activeTheme]) {
        state.themeOverrides[state.activeTheme] = {};
      }
      state.themeOverrides[state.activeTheme][input.dataset.token] = input.value;
      localStorage.setItem("retro-theme-overrides", JSON.stringify(state.themeOverrides));
      applyTheme();
      syncOverview();
    });
  });
}

function applyTheme() {
  const theme = getActiveTheme();
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.colors.bg);
  root.style.setProperty("--panel", theme.colors.panel);
  root.style.setProperty("--panel-2", theme.colors.panel2);
  root.style.setProperty("--accent", theme.colors.accent);
  root.style.setProperty("--glow", theme.colors.glow);
  root.style.setProperty("--text", theme.colors.text);
  root.style.setProperty("--muted", theme.colors.muted);
  root.style.setProperty("--border", theme.colors.border);
  root.style.setProperty("--border-strong", theme.colors.borderStrong);
  root.style.setProperty("--surface-card", theme.colors.surfaceCard);
  root.style.setProperty("--surface-dark", theme.colors.surfaceDark);
  root.style.setProperty("--surface-dark-elevated", theme.colors.surfaceDarkElevated);
}

function getActiveTheme() {
  const baseTheme = structuredClone(themePresets[state.activeTheme]);
  const overrides = state.themeOverrides[state.activeTheme] || {};
  Object.assign(baseTheme.colors, overrides);
  return baseTheme;
}

function resetActiveTheme() {
  delete state.themeOverrides[state.activeTheme];
  localStorage.setItem("retro-theme-overrides", JSON.stringify(state.themeOverrides));
  renderThemePickers();
  applyTheme();
  syncOverview();
}

async function submitDownload() {
  if (!state.backendAvailable) {
    downloadMessage.textContent =
      "Downloads require the local app server at http://127.0.0.1:4310.";
    return;
  }

  if (!state.downloadSupported) {
    downloadMessage.textContent =
      "Hosted downloads are disabled on this deployment.";
    return;
  }

  const url = downloadUrlInput.value.trim();
  if (!url) {
    downloadMessage.textContent = "Paste a Spotify or YouTube URL first.";
    return;
  }

  downloadMessage.textContent = "Queueing download...";
  const response = await fetch("/api/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });
  const payload = await response.json();
  downloadMessage.textContent = payload.error || payload.message || "Request finished.";
  downloadUrlInput.value = "";
  await loadDownloads();
  setTimeout(loadLibrary, 1500);
}

async function loadDownloads() {
  const response = await fetch("/api/downloads");
  const payload = await response.json();
  const jobs = payload.jobs || [];
  downloadCount.textContent = String(jobs.length);

  if (jobs.length === 0) {
    downloadJobs.innerHTML = `<div class="job-card"><p class="meta-text">No downloads queued yet.</p></div>`;
    syncOverview();
    return;
  }

  downloadJobs.innerHTML = jobs
    .map((job) => {
      const output = Array.isArray(job.output) ? job.output.slice(-2).join(" ").trim() : "";
      return `
        <article class="job-card">
          <div class="job-row">
            <strong>${escapeHtml(job.status)}</strong>
            <span class="track-meta">${escapeHtml(job.startedAt)}</span>
          </div>
          <div class="job-meta">${escapeHtml(job.url)}</div>
          <div class="job-meta">${escapeHtml(job.error || output || "Waiting for output...")}</div>
        </article>
      `;
    })
    .join("");

  syncOverview();
}

async function loadSpotifyStatus() {
  if (!state.backendAvailable) {
    connectionPill.textContent = "Backend Unavailable";
    spotifyLogoutButton.disabled = true;
    spotifyPlaylists.innerHTML = `<div class="data-card"><p class="meta-text">Local backend required.</p></div>`;
    spotifyRecent.innerHTML = `<div class="data-card"><p class="meta-text">Local backend required.</p></div>`;
    spotifySearchResults.innerHTML = `<div class="data-card"><p class="meta-text">Local backend required.</p></div>`;
    syncOverview();
    return;
  }

  const response = await fetch("/api/spotify/status");
  const payload = await response.json();
  state.spotifyConnected = Boolean(payload.connected);
  connectionPill.textContent = state.spotifyConnected ? "Spotify Linked" : "Offline Spotify";
  spotifyLogoutButton.disabled = !state.spotifyConnected;

  if (!state.spotifyConnected) {
    if (state.spotifyConfigured) {
      spotifyAccount.innerHTML =
        `<p class="meta-text">Spotify is configured. Use <strong>Connect Spotify</strong> to link your account and fetch private data.</p>`;
    }
    spotifyPlaylists.innerHTML = `<div class="data-card"><p class="meta-text">Connect Spotify to load playlists.</p></div>`;
    spotifyRecent.innerHTML = `<div class="data-card"><p class="meta-text">Recent playback appears here after login.</p></div>`;
    spotifySearchResults.innerHTML = `<div class="data-card"><p class="meta-text">Search results will appear here.</p></div>`;
    syncOverview();
    return;
  }

  const [me, playlists, recent] = await Promise.all([
    fetchSpotifyJson("/api/spotify/me"),
    fetchSpotifyJson("/api/spotify/playlists"),
    fetchSpotifyJson("/api/spotify/recent")
  ]);

  renderSpotifyAccount(me);
  renderSpotifyPlaylists(playlists);
  renderSpotifyRecent(recent);
  syncOverview();
}

async function disconnectSpotify() {
  if (!state.backendAvailable) {
    return;
  }
  await fetch("/api/spotify/logout", { method: "POST" });
  spotifyAccount.innerHTML =
    `<p class="meta-text">Spotify disconnected. Connect again to fetch account data.</p>`;
  await loadSpotifyStatus();
}

async function runSpotifySearch() {
  if (!state.backendAvailable) {
    spotifySearchResults.innerHTML =
      `<div class="data-card"><p class="meta-text">Spotify search requires the local app server.</p></div>`;
    return;
  }

  const query = spotifySearchInput.value.trim();
  if (!query) {
    return;
  }

  const results = await fetchSpotifyJson(`/api/spotify/search?q=${encodeURIComponent(query)}`);
  const tracks = results?.tracks?.items || [];
  if (tracks.length === 0) {
    spotifySearchResults.innerHTML = `<div class="data-card"><p class="meta-text">No tracks matched.</p></div>`;
    return;
  }

  spotifySearchResults.innerHTML = tracks
    .map((track) => {
      const externalUrl = track.external_urls?.spotify || "";
      return `
        <article class="data-card">
          <div class="data-row">
            <strong>${escapeHtml(track.name)}</strong>
            <button class="button-secondary" data-download-url="${escapeHtml(externalUrl)}">Queue</button>
          </div>
          <div class="track-meta">${escapeHtml(track.artists.map((artist) => artist.name).join(", "))}</div>
        </article>
      `;
    })
    .join("");

  spotifySearchResults.querySelectorAll("[data-download-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      downloadUrlInput.value = button.dataset.downloadUrl;
      setView("downloads");
      await submitDownload();
    });
  });
}

function renderSpotifyAccount(profile) {
  spotifyAccount.innerHTML = `
    <div class="data-row">
      <div>
        <strong>${escapeHtml(profile.display_name || "Spotify User")}</strong>
        <div class="track-meta">${escapeHtml(profile.email || "Private email")}</div>
      </div>
      <span class="badge library">${escapeHtml((profile.product || "free").toUpperCase())}</span>
    </div>
  `;
}

function renderSpotifyPlaylists(payload) {
  const items = payload?.items || [];
  spotifyPlaylists.innerHTML = items.length
    ? items
        .map(
          (playlist) => `
            <article class="data-card">
              <strong>${escapeHtml(playlist.name)}</strong>
              <div class="track-meta">${playlist.tracks?.total || 0} tracks</div>
            </article>
          `
        )
        .join("")
    : `<div class="data-card"><p class="meta-text">No playlists returned.</p></div>`;
}

function renderSpotifyRecent(payload) {
  const items = payload?.items || [];
  spotifyRecent.innerHTML = items.length
    ? items
        .map(
          (entry) => `
            <article class="data-card">
              <strong>${escapeHtml(entry.track?.name || "Unknown track")}</strong>
              <div class="track-meta">${escapeHtml((entry.track?.artists || []).map((artist) => artist.name).join(", "))}</div>
            </article>
          `
        )
        .join("")
    : `<div class="data-card"><p class="meta-text">No recent tracks returned.</p></div>`;
}

async function fetchSpotifyJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    return {};
  }
  return payload;
}

function syncOverview() {
  const theme = themePresets[state.activeTheme]?.label || "Custom";
  activeThemeLabel.textContent = theme.toLowerCase();

  if (!state.backendAvailable) {
    spotifySummary.textContent =
      "This published site is frontend-only. Open http://127.0.0.1:4310 for Spotify, downloads, and library persistence.";
    return;
  }

  if (!state.storageConfigured) {
    spotifySummary.textContent =
      state.spotifyConfigured
        ? "Spotify can work here, but persistent library storage still needs HERENOW_API_KEY."
        : "Hosted mode is active, but Spotify and storage still need deployment environment variables.";
    return;
  }

  if (!state.spotifyConfigured) {
    spotifySummary.textContent = "Spotify credentials are not configured in .env yet.";
  } else if (state.spotifyConnected) {
    spotifySummary.textContent = "Spotify connected. Playlists, recent tracks, and search are available.";
  } else {
    spotifySummary.textContent = "Spotify is configured but waiting for account authorization.";
  }
}

function renderBackendUnavailableState() {
  connectionPill.textContent = "Backend Unavailable";
  libraryList.innerHTML =
    `<div class="track-card"><p class="meta-text">Local backend required for library refresh on the published site.</p></div>`;
  downloadJobs.innerHTML =
    `<div class="job-card"><p class="meta-text">Local backend required for downloads.</p></div>`;
  spotifyPlaylists.innerHTML =
    `<div class="data-card"><p class="meta-text">Local backend required for Spotify.</p></div>`;
  spotifyRecent.innerHTML =
    `<div class="data-card"><p class="meta-text">Local backend required for Spotify.</p></div>`;
  spotifySearchResults.innerHTML =
    `<div class="data-card"><p class="meta-text">Local backend required for Spotify.</p></div>`;
}

function loadThemeOverrides() {
  try {
    return JSON.parse(localStorage.getItem("retro-theme-overrides") || "{}");
  } catch (error) {
    return {};
  }
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function colorInputValue(value) {
  if (typeof value !== "string") {
    return "#000000";
  }
  if (value.startsWith("#")) {
    return value;
  }
  const rgbaMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbaMatch) {
    return "#000000";
  }
  const [, red, green, blue] = rgbaMatch;
  return `#${[red, green, blue]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
