import re
import os
from pathlib import Path
from flask import Flask, request, jsonify, redirect, send_from_directory
from flask_cors import CORS
import yt_dlp

ROOT_DIR = Path(__file__).parent.parent
app = Flask(__name__, static_folder=str(ROOT_DIR), static_url_path="")
CORS(app)

QUALITY_LABEL_MAP = {
    "144":  "144p",
    "240":  "240p",
    "360":  "360p",
    "480":  "480p",
    "720":  "720p",
    "1080": "1080p (No Audio/Requires PRO)",
}

def get_quality_label(height: int) -> str:
    return QUALITY_LABEL_MAP.get(str(height), f"{height}p")

def format_filesize(size_bytes: int) -> str:
    if not size_bytes: return ""
    if size_bytes >= 1_048_576: return f"{size_bytes / 1_048_576:.0f} MB"
    if size_bytes >= 1_024: return f"{size_bytes / 1_024:.0f} KB"
    return f"{size_bytes} B"

def extract_info_fast(url: str):
    opts = {
        "quiet": True, 
        "no_warnings": True, 
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)

@app.route("/")
def index():
    return send_from_directory(str(ROOT_DIR), "index.html")

@app.route("/<path:path>")
def static_proxy(path):
    file_path = ROOT_DIR / path
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(ROOT_DIR), path)
    return send_from_directory(str(ROOT_DIR), "index.html")

@app.route("/api/info", methods=["GET"])
def video_info():
    url = request.args.get("url", "").strip()
    if not url: return jsonify({"error": "No URL"}), 400

    try:
        info = extract_info_fast(url)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    qualities = []
    seen_heights = set()

    formats = info.get("formats", [])
    formats = sorted(formats, key=lambda f: f.get("height") or 0, reverse=True)

    for fmt in formats:
        h = fmt.get("height")
        vcodec = fmt.get("vcodec", "none")
        acodec = fmt.get("acodec", "none")

        if not h or vcodec == "none" or acodec == "none":
            continue
        
        if h in seen_heights:
            continue

        seen_heights.add(h)
        fsize = fmt.get("filesize") or fmt.get("filesize_approx") or 0
        
        qualities.append({
            "height": h,
            "label": get_quality_label(h),
            "filesize_str": format_filesize(fsize),
            "format_id": fmt.get("format_id")
        })

    qualities.sort(key=lambda q: q["height"])

    thumbnails = info.get("thumbnails", [])
    thumb = info.get("thumbnail", "")
    if thumbnails:
        best = max(thumbnails, key=lambda t: (t.get("width") or 0))
        thumb = best.get("url", thumb)

    return jsonify({
        "title": info.get("title", "Unknown"),
        "channel": info.get("uploader", "Unknown"),
        "duration": info.get("duration", 0),
        "view_count": info.get("view_count", 0),
        "thumbnail": thumb,
        "qualities": qualities,
        "cookie_browser": None
    })

@app.route("/api/download", methods=["GET"])
def download_video():
    url = request.args.get("url", "").strip()
    format_id = request.args.get("format_id", "")

    if not url or not format_id:
        return jsonify({"error": "Missing params"}), 400

    try:
        opts = {
            "quiet": True, 
            "no_warnings": True, 
            "skip_download": True,
            "format": format_id
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            direct_url = info.get("url")
            if not direct_url:
                return jsonify({"error": "Could not extract direct URL"}), 500
            
            return jsonify({"download_url": direct_url})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)
