/* ════════════════════════════════════════════════════════════
   YTGrab — App Logic (Vercel Edition)
   ════════════════════════════════════════════════════════════ */

const API_BASE = "";

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
let selectedFormatId = null;
let selectedFilesize = "";
let toastTimer       = null;

// ── Helpers ───────────────────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function formatViews(n) {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `${(n/1_000_000_000).toFixed(1)}B views`;
  if (n >= 1_000_000)     return `${(n/1_000_000).toFixed(1)}M views`;
  if (n >= 1_000)         return `${(n/1_000).toFixed(0)}K views`;
  return `${n} views`;
}

function setLoading(btn, state) {
  btn.classList.toggle("loading", state);
  btn.disabled = state;
}

function showToast(message, type = "info", duration = 3500) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

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
  videoTitle.textContent = data.title;
  titleSkel.classList.add("hidden");
  videoTitle.classList.remove("hidden");

  videoChannel.textContent = data.channel;
  channelSkel.classList.add("hidden");
  videoChannel.classList.remove("hidden");

  viewCount.textContent  = formatViews(data.view_count);
  durDisplay.textContent = formatDuration(data.duration);
  videoStats.classList.remove("hidden");
  durationBadge.textContent = formatDuration(data.duration);

  thumbnail.alt    = data.title;
  thumbnail.onload = () => { thumbSkel.classList.add("hidden"); thumbnail.classList.remove("hidden"); };
  thumbnail.onerror= () => { thumbSkel.classList.add("hidden"); thumbnail.classList.remove("hidden"); };
  thumbnail.src    = data.thumbnail;

  buildQualityPills(data.qualities);
  qualitySection.classList.remove("hidden");
  downloadBtn.classList.remove("hidden");
}

// ── Quality Pills ─────────────────────────────────────────────
function buildQualityPills(qualities) {
  qualityGrid.innerHTML = "";
  selectedQuality  = null;
  selectedFormatId = null;
  selectedFilesize = "";

  if (!qualities || qualities.length === 0) {
    qualityGrid.innerHTML = '<p style="color:var(--text-3);font-size:.85rem;">No downloadable pre-merged qualities found.</p>';
    return;
  }

  const preferred  = qualities[qualities.length - 1];
  selectedQuality  = preferred.height;
  selectedFormatId = preferred.format_id;
  selectedFilesize = preferred.filesize_str || "";

  qualities.forEach(q => {
    const pill = document.createElement("button");
    pill.className   = "quality-pill" + (q.format_id === selectedFormatId ? " selected" : "");
    pill.dataset.formatId = q.format_id;
    pill.dataset.height   = q.height;
    pill.dataset.filesize = q.filesize_str || "";

    let tierBadge = "";
    if      (q.height >= 2160) tierBadge = "4K";
    else if (q.height >= 1440) tierBadge = "2K";
    else if (q.height >= 1080) tierBadge = "FHD";
    else if (q.height >= 720)  tierBadge = "HD";

    const sizeBadge = q.filesize_str ? `<span class="pill-size">${q.filesize_str}</span>` : "";
    const tierHtml  = tierBadge ? `<span class="pill-badge">${tierBadge}</span>` : "";

    pill.innerHTML = `<span class="pill-label">${q.label}</span>${tierHtml}${sizeBadge}`;

    pill.addEventListener("click", () => selectQuality(q.height, q.format_id, q.filesize_str || ""));
    qualityGrid.appendChild(pill);
  });

  updateDownloadBtnLabel();
}

function selectQuality(height, formatId, filesizeStr) {
  selectedQuality  = height;
  selectedFormatId = formatId;
  selectedFilesize = filesizeStr;
  qualityGrid.querySelectorAll(".quality-pill").forEach(pill => {
    const isSel = pill.dataset.formatId === formatId;
    pill.classList.toggle("selected", isSel);
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
async function downloadVideo() {
  if (!currentVideoData || !selectedFormatId) {
    showToast("Please fetch a video and select quality first.", "error");
    return;
  }

  const { url } = currentVideoData;

  progressWrap.classList.remove("hidden");
  downloadBtn.classList.add("hidden");
  progressLabel.textContent = "Extracting direct download link…";

  try {
    const res = await fetch(`${API_BASE}/api/download?url=${encodeURIComponent(url)}&format_id=${selectedFormatId}`);
    const data = await res.json();

    if (!res.ok || data.error || !data.download_url) {
      throw new Error(data.error || "Failed to generate download link.");
    }

    progressLabel.textContent = "Opening stream…";
    window.location.href = data.download_url;

    setTimeout(() => {
      progressWrap.classList.add("hidden");
      downloadBtn.classList.remove("hidden");
      showToast("Download started!", "success");
    }, 2000);

  } catch (err) {
    progressWrap.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
    showToast(`Error: ${err.message}`, "error", 5000);
    console.error(err);
  }
}

// ── Event Listeners ───────────────────────────────────────────
fetchBtn.addEventListener("click", fetchVideoInfo);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") fetchVideoInfo(); });
urlInput.addEventListener("input", () => { urlError.textContent = ""; });
urlInput.addEventListener("paste", () => { setTimeout(() => { if (isYouTubeUrl(urlInput.value.trim())) fetchVideoInfo(); }, 100); });
downloadBtn.addEventListener("click", downloadVideo);
