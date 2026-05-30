const state = {
  videos: [],
  filtered: [],
  activeId: "",
  thumbnailObserver: null,
  progress: {},
  saveTimer: null,
  pendingResumeId: "",
  ignoreProgressVideoId: "",
  lastSaveAt: 0,
  preview: {
    id: "",
    timer: null,
    video: null,
    started: false
  }
};

const elements = {
  playerShell: document.querySelector("#playerShell"),
  player: document.querySelector("#player"),
  rotateHint: document.querySelector("#rotateHint"),
  nowName: document.querySelector("#nowName"),
  nowFolder: document.querySelector("#nowFolder"),
  listPanel: document.querySelector("#listPanel"),
  videoList: document.querySelector("#videoList"),
  emptyState: document.querySelector("#emptyState"),
  fullscreenButton: document.querySelector("#fullscreenButton")
};

const STORAGE_KEY = "lan-video-share-progress-v1";
const WATCHED_RATIO = 0.9;
const RESUME_OFFSET_SECONDS = 2;

function loadProgress() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    state.progress = value ? JSON.parse(value) : {};
  } catch {
    state.progress = {};
  }
}

function saveProgressNow() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = null;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function saveProgressSoon() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveProgressNow, 300);
}

function getProgress(videoId) {
  return state.progress[videoId] || {
    completed: false,
    duration: 0,
    time: 0,
    updatedAt: 0
  };
}

function getProgressRatio(videoId) {
  const progress = getProgress(videoId);
  if (!progress.duration || progress.duration <= 0) {
    return 0;
  }
  return Math.min(progress.time / progress.duration, 1);
}

function isWatched(videoId) {
  return getProgress(videoId).completed || getProgressRatio(videoId) >= WATCHED_RATIO;
}

function sortVideos(videos) {
  return [...videos].sort((a, b) => {
    const watchedDelta = Number(isWatched(a.id)) - Number(isWatched(b.id));
    if (watchedDelta !== 0) {
      return watchedDelta;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getTokenQuery() {
  const token = new URLSearchParams(window.location.search).get("token");
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

function withToken(url) {
  return `${url}${getTokenQuery()}`;
}

function getActiveIndex() {
  return state.filtered.findIndex((video) => video.id === state.activeId);
}

function getVideoByStep(step) {
  if (state.filtered.length === 0) {
    return null;
  }

  const activeIndex = getActiveIndex();
  const baseIndex = activeIndex === -1 ? 0 : activeIndex;
  const nextIndex = (baseIndex + step + state.filtered.length) % state.filtered.length;
  return state.filtered[nextIndex];
}

function updateActiveItem() {
  for (const item of elements.videoList.querySelectorAll(".video-item")) {
    item.classList.toggle("active", item.dataset.id === state.activeId);
  }

  if (state.activeId) {
    const activeItem = elements.videoList.querySelector(".video-item.active");
    activeItem?.scrollIntoView({ block: "nearest" });
  }
}

function updateFullscreenButton() {
  elements.fullscreenButton.disabled = state.filtered.length === 0;
}

function stopPreview() {
  window.clearTimeout(state.preview.timer);
  state.preview.timer = null;
  state.preview.id = "";
  if (state.preview.video) {
    state.preview.video.pause();
    state.preview.video.removeAttribute("src");
    state.preview.video.load();
    state.preview.video.hidden = true;
    state.preview.video = null;
  }
  window.setTimeout(() => {
    state.preview.started = false;
  }, 80);
}

function startPreviewSoon(video, container) {
  stopPreview();
  state.preview.id = video.id;
  state.preview.timer = window.setTimeout(() => {
    const previewVideo = container.querySelector(".preview-video");
    if (!previewVideo || state.preview.id !== video.id) {
      return;
    }

    state.preview.video = previewVideo;
    state.preview.started = true;

    previewVideo.src = withToken(video.url);
    previewVideo.hidden = false;
    previewVideo.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(previewVideo.duration) && previewVideo.duration > 30) {
        previewVideo.currentTime = Math.min(previewVideo.duration * 0.38, previewVideo.duration - 8);
      }
      previewVideo.play().catch(() => {});
    }, { once: true });
  }, 420);
}

function drawThumbnail(video, canvas) {
  if (canvas.dataset.loaded === "1") {
    return;
  }

  canvas.dataset.loaded = "1";
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.muted = true;
  probe.playsInline = true;
  probe.src = withToken(video.url);

  const drawFallback = () => {
    const context = canvas.getContext("2d");
    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "28px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("▶", canvas.width / 2, canvas.height / 2);
  };

  const capture = () => {
    try {
      const context = canvas.getContext("2d");
      context.drawImage(probe, 0, 0, canvas.width, canvas.height);
    } catch {
      drawFallback();
    } finally {
      probe.removeAttribute("src");
      probe.load();
    }
  };

  probe.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(probe.duration) && probe.duration > 2) {
      probe.currentTime = Math.min(12, probe.duration * 0.12);
    } else {
      capture();
    }
  }, { once: true });
  probe.addEventListener("seeked", capture, { once: true });
  probe.addEventListener("error", drawFallback, { once: true });
}

function observeThumbnail(video, canvas) {
  if (!state.thumbnailObserver) {
    state.thumbnailObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const item = entry.target;
          state.thumbnailObserver.unobserve(item);
          drawThumbnail(item.__video, item);
        }
      }
    }, { rootMargin: "240px" });
  }

  canvas.__video = video;
  state.thumbnailObserver.observe(canvas);
}

function renderList() {
  const previousScrollTop = elements.listPanel.scrollTop;
  elements.videoList.innerHTML = "";
  elements.emptyState.hidden = state.filtered.length > 0;
  updateFullscreenButton();

  const fragment = document.createDocumentFragment();
  for (const video of state.filtered) {
    const button = document.createElement("button");
    button.className = `video-item${video.id === state.activeId ? " active" : ""}`;
    if (isWatched(video.id)) {
      button.classList.add("watched");
    }
    button.type = "button";
    button.dataset.id = video.id;

    const thumb = document.createElement("div");
    thumb.className = "video-thumb";

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.className = "thumb-canvas";
    observeThumbnail(video, canvas);

    const previewVideo = document.createElement("video");
    previewVideo.className = "preview-video";
    previewVideo.muted = true;
    previewVideo.loop = true;
    previewVideo.playsInline = true;
    previewVideo.preload = "none";
    previewVideo.hidden = true;

    const badge = document.createElement("span");
    badge.className = "thumb-badge";
    badge.textContent = isWatched(video.id) ? "已看" : "长按预览";

    const progressBar = document.createElement("span");
    progressBar.className = "thumb-progress";
    progressBar.style.setProperty("--progress", `${Math.round(getProgressRatio(video.id) * 100)}%`);

    thumb.append(canvas, previewVideo, progressBar, badge);

    const detail = document.createElement("div");
    detail.className = "video-detail";

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = video.name;

    const meta = document.createElement("div");
    meta.className = "video-meta";

    const folder = document.createElement("span");
    folder.textContent = video.folder || "根目录";

    const size = document.createElement("span");
    size.textContent = formatBytes(video.size);

    const modified = document.createElement("span");
    modified.textContent = formatDate(video.modifiedAt);

    meta.append(folder, size, modified);
    detail.append(title, meta);
    button.append(thumb, detail);
    button.addEventListener("click", (event) => {
      if (state.preview.started) {
        event.preventDefault();
        return;
      }
      playVideo(video);
    });
    button.addEventListener("pointerdown", () => startPreviewSoon(video, button));
    button.addEventListener("pointerup", stopPreview);
    button.addEventListener("pointerleave", stopPreview);
    button.addEventListener("pointercancel", stopPreview);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    fragment.append(button);
  }

  elements.videoList.append(fragment);
  elements.listPanel.scrollTop = previousScrollTop;

  updateActiveItem();
}

function playVideo(video) {
  stopPreview();
  state.activeId = video.id;
  state.pendingResumeId = video.id;
  state.ignoreProgressVideoId = "";
  elements.player.src = withToken(video.url);
  elements.player.play().catch(() => {});
  elements.nowName.textContent = video.name;
  elements.nowFolder.textContent = video.folder || "根目录";
  updateActiveItem();
}

function playStep(step) {
  const video = getVideoByStep(step);
  if (video) {
    playVideo(video);
  }
}

function waitForMetadata() {
  if (elements.player.videoWidth > 0 && elements.player.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(done, 1200);
    elements.player.addEventListener("loadedmetadata", done, { once: true });
  });
}

async function requestSmartFullscreen() {
  if (!state.activeId) {
    const firstVideo = state.filtered[0];
    if (firstVideo) {
      playVideo(firstVideo);
    }
  }

  await waitForMetadata();
  const isLandscapeVideo = elements.player.videoWidth > elements.player.videoHeight;
  const orientation = isLandscapeVideo ? "landscape" : "portrait";
  try {
    if (elements.player.requestFullscreen) {
      await elements.player.requestFullscreen();
    } else if (elements.player.webkitEnterFullscreen) {
      elements.player.webkitEnterFullscreen();
    }

    if (screen.orientation?.lock) {
      await screen.orientation.lock(orientation).catch(() => {});
    }
  } finally {
    elements.rotateHint.textContent = isLandscapeVideo
      ? "横屏视频，旋转手机观看更舒服"
      : "竖屏视频，保持竖屏观看更舒服";
    elements.rotateHint.hidden = false;
    window.setTimeout(() => {
      elements.rotateHint.hidden = true;
    }, 2800);
  }
}

async function loadVideos() {
  const response = await fetch(`/api/videos${getTokenQuery()}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  state.videos = data.videos;
  state.filtered = sortVideos(state.videos);
  renderList();
}

function updateVideoProgress(options = {}) {
  if (!state.activeId || !Number.isFinite(elements.player.duration)) {
    return;
  }

  if (state.activeId === state.ignoreProgressVideoId) {
    return;
  }

  const current = getProgress(state.activeId);
  const duration = elements.player.duration || current.duration || 0;
  const time = Math.max(elements.player.currentTime || 0, 0);
  const completed = options.completed || current.completed || (duration > 0 && time / duration >= WATCHED_RATIO);
  state.progress[state.activeId] = {
    completed,
    duration,
    time: completed ? duration : time,
    updatedAt: Date.now()
  };
  updateVideoCardProgress(state.activeId);
  saveProgressSoon();
}

function updateVideoCardProgress(videoId) {
  const item = [...elements.videoList.querySelectorAll(".video-item")]
    .find((candidate) => candidate.dataset.id === videoId);
  if (!item) {
    return;
  }

  const watched = isWatched(videoId);
  item.classList.toggle("watched", watched);
  const badge = item.querySelector(".thumb-badge");
  if (badge) {
    badge.textContent = watched ? "已看" : "长按预览";
  }

  const progressBar = item.querySelector(".thumb-progress");
  if (progressBar) {
    progressBar.style.setProperty("--progress", `${Math.round(getProgressRatio(videoId) * 100)}%`);
  }
}

function resumeActiveVideo() {
  if (!state.pendingResumeId || state.pendingResumeId !== state.activeId) {
    return;
  }

  const progress = getProgress(state.activeId);
  state.pendingResumeId = "";
  if (progress.completed || !progress.time || progress.time < 5) {
    return;
  }

  const safeTime = Math.max(progress.time - RESUME_OFFSET_SECONDS, 0);
  if (elements.player.duration && safeTime < elements.player.duration - 5) {
    elements.player.currentTime = safeTime;
  }
}

loadProgress();
elements.fullscreenButton.addEventListener("click", requestSmartFullscreen);
elements.player.addEventListener("loadedmetadata", resumeActiveVideo);
elements.player.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - state.lastSaveAt > 1500) {
    state.lastSaveAt = now;
    updateVideoProgress();
  }
});
elements.player.addEventListener("pause", () => updateVideoProgress());
elements.player.addEventListener("ended", () => {
  updateVideoProgress({ completed: true });
  state.filtered = sortVideos(state.videos);
  renderList();
  const nextUnwatched = state.filtered.find((video) => !isWatched(video.id));
  if (nextUnwatched) {
    playVideo(nextUnwatched);
  } else {
    playStep(1);
  }
});
window.addEventListener("pagehide", () => {
  updateVideoProgress();
  saveProgressNow();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && screen.orientation?.unlock) {
    screen.orientation.unlock();
  }
});

loadVideos().catch((error) => {
  elements.nowName.textContent = `读取失败：${error.message}`;
  elements.emptyState.hidden = false;
  elements.emptyState.textContent = "无法读取视频列表";
});
