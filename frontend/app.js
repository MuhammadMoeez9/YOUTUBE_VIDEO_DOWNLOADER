/* ════════════════════════════════════════════════════════════
   YTGrab — App Logic
   ════════════════════════════════════════════════════════════ */

const API_BASE = "http://localhost:5000";

// ── DOM References ────────────────────────────────────────────
const urlInput       = document.getElementById("url-input");
const fetchBtn       = document.getElementById("fetch-btn");
const urlError       = document.getElementById("url-error");
const videoCard      = document.getElementById("video-card");
const thumbSkel      = document.getElementById("thumb-skeleton");
const channelSkel    = document.getElementById("channel-skeleton");
const titleSkel      = document.getElementById("title-skeleton");
const thumbnail      = document.getElementById("thumbnail");
const durationBadge  = document.getElementById("duration-badge");
const videoTitle     = document.getElementById("video-title");
const videoChannel   = document.getElementById("video-channel");
const videoStats     = document.getElementById("video-stats");
const viewCount      = document.getElementById("view-count");
const durDisplay     = document.getElementById("dur-display");
const qualitySection = document.getElementById("quality-section");
const qualityGrid    = document.getElementById("quality-grid");
const downloadBtn    = document.getElementById("download-btn");
const progressWrap   = document.getElementById("progress-wrap");
const progressLabel  = document.getElementById("progress-label");
const toast          = document.getElementById("toast");

// ── State ─────────────────────────────────────────────────────
let currentVideoData = null;
let selectedQuality  = null;
let selectedFilesize = "";       // human-readable estimate for selected quality
let cookieBrowser    = null;     // which browser yt-dlp used for cookies
let toastTimer       = null;
let downloadPollTimer = null;

// ── Helpers ───────────────────────────────────────────────────

/** Format seconds → M:SS or H:MM:SS */
function formatDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

/** Format view count → "1.2M views" */
function formatViews(n) {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `${(n/1_000_000_000).toFixed(1)}B views`;
  if (n >= 1_000_000)     return `${(n/1_000_000).toFixed(1)}M views`;
  if (n >= 1_000)         return `${(n/1_000).toFixed(0)}K views`;
  return `${n} views`;
}

/** Show/hide button loading spinner */
function setLoading(btn, state) {
  btn.classList.toggle("loading", state);
  btn.disabled = state;
}

/** Display toast notification */
function showToast(message, type = "info", duration = 3500) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  void toast.offsetWidth;   // reflow
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

/** Validate YouTube URL */
function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be");
  } catch { return false; }
}

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton() {
  videoCard.classList.remove("hidden");
  thumbSkel.classList.remove("hidden");
  titleSkel.classList.remove("hidden");
  channelSkel.classList.remove("hidden");
  thumbnail.classList.add("hidden");
  videoTitle.classList.add("hidden");
  videoChannel.classList.add("hidden");
  videoStats.classList.add("hidden");
  qualitySection.classList.add("hidden");
  downloadBtn.classList.add("hidden");
  progressWrap.classList.add("hidden");
}

// ── Populate Video Card ───────────────────────────────────────
function populateVideoCard(data) {
  // Title
  videoTitle.textContent = data.title;
  titleSkel.classList.add("hidden");
  videoTitle.classList.remove("hidden");

  // Channel
  videoChannel.textContent = data.channel;
  channelSkel.classList.add("hidden");
  videoChannel.classList.remove("hidden");

  // Stats
  viewCount.textContent  = formatViews(data.view_count);
  durDisplay.textContent = formatDuration(data.duration);
  videoStats.classList.remove("hidden");
  durationBadge.textContent = formatDuration(data.duration);

  // Thumbnail
  thumbnail.alt    = data.title;
  thumbnail.onload = () => { thumbSkel.classList.add("hidden"); thumbnail.classList.remove("hidden"); };
  thumbnail.onerror= () => { thumbSkel.classList.add("hidden"); thumbnail.classList.remove("hidden"); };
  thumbnail.src    = data.thumbnail;

  // Quality pills
  buildQualityPills(data.qualities);
  qualitySection.classList.remove("hidden");
  downloadBtn.classList.remove("hidden");
}

// ── Quality Pills ─────────────────────────────────────────────
function buildQualityPills(qualities) {
  qualityGrid.innerHTML = "";
  selectedQuality  = null;
  selectedFilesize = "";

  if (!qualities || qualities.length === 0) {
    qualityGrid.innerHTML = '<p style="color:var(--text-3);font-size:.85rem;">No downloadable qualities found.</p>';
    return;
  }

  // Auto-select best ≤ 1080p
  const preferred  = [...qualities].reverse().find(q => q.height <= 1080) || qualities[qualities.length - 1];
  selectedQuality  = preferred.height;
  selectedFilesize = preferred.filesize_str || "";

  qualities.forEach(q => {
    const pill = document.createElement("button");
    pill.className   = "quality-pill" + (q.height === selectedQuality ? " selected" : "");
    pill.dataset.height   = q.height;
    pill.dataset.filesize = q.filesize_str || "";
    pill.setAttribute("role", "radio");
    pill.setAttribute("aria-checked", q.height === selectedQuality ? "true" : "false");
    pill.setAttribute("aria-label", `Select ${q.label}`);

    // Resolution tier badge
    let tierBadge = "";
    if      (q.height >= 2160) tierBadge = "4K";
    else if (q.height >= 1440) tierBadge = "2K";
    else if (q.height >= 1080) tierBadge = "FHD";
    else if (q.height >= 720)  tierBadge = "HD";

    // File size badge
    const sizeBadge = q.filesize_str ? `<span class="pill-size">${q.filesize_str}</span>` : "";
    const tierHtml  = tierBadge ? `<span class="pill-badge">${tierBadge}</span>` : "";

    pill.innerHTML = `<span class="pill-label">${q.label}</span>${tierHtml}${sizeBadge}`;

    pill.addEventListener("click", () => selectQuality(q.height, q.filesize_str || ""));
    qualityGrid.appendChild(pill);
  });

  updateDownloadBtnLabel();
}

function selectQuality(height, filesizeStr) {
  selectedQuality  = height;
  selectedFilesize = filesizeStr;
  qualityGrid.querySelectorAll(".quality-pill").forEach(pill => {
    const isSel = Number(pill.dataset.height) === height;
    pill.classList.toggle("selected", isSel);
    pill.setAttribute("aria-checked", isSel ? "true" : "false");
  });
  updateDownloadBtnLabel();
}

function updateDownloadBtnLabel() {
  const btnText = downloadBtn.querySelector(".btn-text");
  if (!btnText) return;
  btnText.textContent = selectedFilesize
    ? `Download  ·  ~${selectedFilesize}`
    : "Download";
}

// ── Fetch Video Info ──────────────────────────────────────────
async function fetchVideoInfo() {
  const url = urlInput.value.trim();
  urlError.textContent = "";

  if (!url) {
    urlError.textContent = "Please enter a YouTube URL.";
    urlInput.focus();
    return;
  }
  if (!isYouTubeUrl(url)) {
    urlError.textContent = "That doesn't look like a valid YouTube URL.";
    urlInput.focus();
    return;
  }

  setLoading(fetchBtn, true);
  showSkeleton();
  currentVideoData = null;

  try {
    const res  = await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);

    currentVideoData = { ...data, url };
    cookieBrowser    = data.cookie_browser || null;
    populateVideoCard(data);
    showToast("Video info loaded!", "success");

  } catch (err) {
    console.error(err);
    videoCard.classList.add("hidden");
    urlError.textContent = `Error: ${err.message}`;
    showToast(err.message, "error", 5000);
  } finally {
    setLoading(fetchBtn, false);
  }
}

// ── Download Video ────────────────────────────────────────────
function downloadVideo() {
  if (!currentVideoData || !selectedQuality) {
    showToast("Please fetch a video and select quality first.", "error");
    return;
  }

  const { url, title } = currentVideoData;

  // Show preparing state
  progressWrap.classList.remove("hidden");
  downloadBtn.classList.add("hidden");

  // Animated status messages while server is downloading+merging
  const steps = [
    "Connecting to YouTube…",
    "Fetching video stream…",
    "Fetching audio stream…",
    "Merging video & audio…",
    "Encoding MP4 container…",
    "Applying fast-start optimisation…",
    "Almost ready…",
  ];
  let stepIdx = 0;
  progressLabel.textContent = steps[0];

  clearInterval(downloadPollTimer);
  downloadPollTimer = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, steps.length - 1);
    progressLabel.textContent = steps[stepIdx];
  }, 4000);

  // Build download URL
  let downloadUrl =
    `${API_BASE}/api/download` +
    `?url=${encodeURIComponent(url)}` +
    `&quality=${selectedQuality}` +
    `&title=${encodeURIComponent(title)}`;

  if (cookieBrowser) downloadUrl += `&browser=${encodeURIComponent(cookieBrowser)}`;

  // Use fetch so we can detect when server responds (file ready)
  fetch(downloadUrl)
    .then(res => {
      clearInterval(downloadPollTimer);

      if (!res.ok) {
        return res.json().then(d => { throw new Error(d.error || `Server error ${res.status}`); });
      }

      // Get actual file size from Content-Length header
      const contentLength = res.headers.get("Content-Length");
      const sizeMB = contentLength
        ? ` (${(parseInt(contentLength) / 1_048_576).toFixed(1)} MB)`
        : "";

      progressLabel.textContent = `Saving file${sizeMB}…`;

      // Stream the blob to trigger browser Save As
      return res.blob();
    })
    .then(blob => {
      const objUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href  = objUrl;
      anchor.download = `${sanitizeFilename(title)}_${selectedQuality}p.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);

      progressWrap.classList.add("hidden");
      downloadBtn.classList.remove("hidden");
      setLoading(downloadBtn, false);
      showToast("Download complete!", "success", 5000);
    })
    .catch(err => {
      clearInterval(downloadPollTimer);
      progressWrap.classList.add("hidden");
      downloadBtn.classList.remove("hidden");
      setLoading(downloadBtn, false);
      showToast(`Download failed: ${err.message}`, "error", 6000);
      console.error(err);
    });
}

function sanitizeFilename(name) {
  return name.replace(/[\\/*?:"<>|]/g, "_").substring(0, 100);
}

// ── Event Listeners ───────────────────────────────────────────
fetchBtn.addEventListener("click", fetchVideoInfo);

urlInput.addEventListener("keydown", e => {
  if (e.key === "Enter") fetchVideoInfo();
});

urlInput.addEventListener("input", () => {
  urlError.textContent = "";
});

urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    if (isYouTubeUrl(urlInput.value.trim())) fetchVideoInfo();
  }, 100);
});

downloadBtn.addEventListener("click", downloadVideo);
