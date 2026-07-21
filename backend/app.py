import re
import os
import threading
import subprocess
import tempfile
from pathlib import Path
from flask import (
    Flask, request, jsonify, Response,
    stream_with_context, send_from_directory,
    send_file, after_this_request,
)
from flask_cors import CORS
import yt_dlp

# Resolve the frontend folder (one level up from backend/)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)

# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

QUALITY_LABEL_MAP = {
    "144":  "144p",
    "240":  "240p",
    "360":  "360p",
    "480":  "480p",
    "720":  "720p (HD)",
    "1080": "1080p (Full HD)",
    "1440": "1440p (2K)",
    "2160": "4K (Ultra HD)",
}

# Browsers to try for cookie extraction, in preference order
BROWSERS = ["chrome", "edge", "firefox", "brave", "opera"]


# Resolving cookies.txt location (useful for cloud deployments like Render)
COOKIES_FILE = Path(__file__).parent.parent / "cookies.txt"


def get_quality_label(height: int) -> str:
    return QUALITY_LABEL_MAP.get(str(height), f"{height}p")


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def format_filesize(size_bytes: int) -> str:
    """Human-readable file size string."""
    if not size_bytes:
        return ""
    if size_bytes >= 1_073_741_824:
        return f"{size_bytes / 1_073_741_824:.1f} GB"
    if size_bytes >= 1_048_576:
        return f"{size_bytes / 1_048_576:.0f} MB"
    if size_bytes >= 1_024:
        return f"{size_bytes / 1_024:.0f} KB"
    return f"{size_bytes} B"


def make_ydl_opts(extra: dict = None, browser: str = None) -> dict:
    """Base yt-dlp options, optionally with browser cookie extraction."""
    opts = {"quiet": True, "no_warnings": True}
    if browser and browser in BROWSERS:
        opts["cookiesfrombrowser"] = (browser,)
    if extra:
        opts.update(extra)
    return opts


def extract_info_with_cookies(url: str, extra_opts: dict = None):
    """
    Try extracting video info, cycling through cookies.txt -> browsers -> no cookies.
    Returns (info_dict, auth_method_used).
    """
    base = {"quiet": True, "no_warnings": True, "skip_download": True}
    if extra_opts:
        base.update(extra_opts)

    last_err = None

    # 1. Try a cookies.txt file first (Required for cloud deployment)
    if COOKIES_FILE.exists():
        opts = {**base, "cookiefile": str(COOKIES_FILE)}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            return info, "cookies.txt"
        except Exception as e:
            last_err = e
            pass # fallback to browsers

    # 2. Try local browsers (Works when running locally on Windows/Mac)
    for browser in BROWSERS:
        opts = {**base, "cookiesfrombrowser": (browser,)}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            return info, browser
        except Exception as e:
            last_err = e
            continue

    # 3. Fallback: no cookies
    try:
        with yt_dlp.YoutubeDL(base) as ydl:
            info = ydl.extract_info(url, download=False)
        return info, None
    except yt_dlp.utils.DownloadError as e:
        raise e


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/api/info", methods=["GET"])
def video_info():
    """Return video metadata + available quality options with estimated sizes."""
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        info, browser_used = extract_info_with_cookies(url)
    except yt_dlp.utils.DownloadError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

    formats = info.get("formats", [])

    # ── Build per-height size estimates ───────────────────────
    # best video filesize per height
    height_video_size: dict[int, int] = {}
    # best audio filesize (no height)
    best_audio_size = 0

    for fmt in formats:
        h      = fmt.get("height") or 0
        vcodec = fmt.get("vcodec", "none")
        acodec = fmt.get("acodec", "none")
        fsize  = fmt.get("filesize") or fmt.get("filesize_approx") or 0

        if h and vcodec not in ("none", None):
            if fsize > height_video_size.get(h, 0):
                height_video_size[h] = fsize

        if not h and acodec not in ("none", None):
            best_audio_size = max(best_audio_size, fsize)

    # ── Collect unique resolutions ─────────────────────────────
    seen_heights: set[int] = set()
    qualities = []

    sorted_fmts = sorted(formats, key=lambda f: (f.get("height") or 0), reverse=True)

    for fmt in sorted_fmts:
        height = fmt.get("height")
        vcodec = fmt.get("vcodec", "none")

        if not height or vcodec in ("none", None):
            continue
        if height in seen_heights:
            continue

        seen_heights.add(height)
        total_size = height_video_size.get(height, 0) + best_audio_size
        qualities.append({
            "height":   height,
            "label":    get_quality_label(height),
            "filesize": total_size,
            "filesize_str": format_filesize(total_size),
        })

    qualities.sort(key=lambda q: q["height"])

    # ── Best thumbnail ─────────────────────────────────────────
    thumbnails = info.get("thumbnails", [])
    thumbnail  = info.get("thumbnail", "")
    if thumbnails:
        best = max(thumbnails, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
        thumbnail = best.get("url", thumbnail)

    return jsonify({
        "title":          info.get("title", "Unknown Title"),
        "channel":        info.get("uploader", "Unknown Channel"),
        "duration":       info.get("duration", 0),
        "view_count":     info.get("view_count", 0),
        "thumbnail":      thumbnail,
        "qualities":      qualities,
        "cookie_browser": browser_used,
    })


@app.route("/api/download", methods=["GET"])
def download_video():
    """
    Download video to a temp file (so ffmpeg can properly mux MP4),
    then serve it to the browser with correct Content-Length.
    Temp file is deleted automatically after the response is sent.
    """
    url     = request.args.get("url", "").strip()
    height  = request.args.get("quality", "720")
    title   = request.args.get("title", "video")
    browser = request.args.get("browser", "")

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    safe_title = sanitize_filename(title)
    filename   = f"{safe_title}_{height}p.mp4"

    # Temp directory — yt-dlp writes here, we serve the file, then delete
    tmp_dir  = tempfile.mkdtemp()
    tmp_path = os.path.join(tmp_dir, filename)

    fmt_selector = (
        f"bestvideo[height<={height}]+bestaudio"
        f"/best[height<={height}]"
        f"/best"
    )

    cmd = [
        "yt-dlp",
        "--quiet",
        "--no-warnings",
        "--format",              fmt_selector,
        "--merge-output-format", "mp4",
        # Ensure ffmpeg produces a fast-start (web-optimized) MP4
        "--postprocessor-args",  "ffmpeg:-movflags +faststart",
        "-o",                    tmp_path,
    ]

    if browser == "cookies.txt" and COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    elif browser and browser in BROWSERS:
        cmd += ["--cookies-from-browser", browser]

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=600)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Download timed out (600 s)."}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # yt-dlp may rename the file (e.g. .webm → .mp4 after merge)
    actual_path = tmp_path
    if not os.path.exists(actual_path):
        files = os.listdir(tmp_dir)
        if not files:
            return jsonify({"error": "yt-dlp produced no output file."}), 500
        actual_path = os.path.join(tmp_dir, files[0])

    if result.returncode != 0 and not os.path.exists(actual_path):
        stderr = result.stderr.decode(errors="replace")
        return jsonify({"error": stderr or "yt-dlp failed."}), 500

    # ── Clean up temp dir after response is sent ───────────────
    @after_this_request
    def cleanup(response):
        def _delete():
            try:
                os.unlink(actual_path)
                os.rmdir(tmp_dir)
            except Exception:
                pass
        t = threading.Thread(target=_delete, daemon=True)
        t.start()
        return response

    return send_file(
        actual_path,
        as_attachment=True,
        download_name=filename,
        mimetype="video/mp4",
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────────
# Serve Frontend
# ─────────────────────────────────────────────

@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    return send_from_directory(str(FRONTEND_DIR), filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  YTGrab running at: http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=True, threaded=True)
