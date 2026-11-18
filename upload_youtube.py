import os
import glob
import json
import sys
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def find_latest_video(preferred_path):
    if os.path.exists(preferred_path):
        return preferred_path
    mp4_files = glob.glob("**/*.mp4", recursive=True)
    if not mp4_files:
        return None
    return max(mp4_files, key=os.path.getmtime)

def load_metadata(meta_path):
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    json_files = [p for p in glob.glob("*.json") if p not in ("package.json", "package-lock.json", "tsconfig.json")]
    if json_files:
        latest_json = max(json_files, key=os.path.getmtime)
        with open(latest_json, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def upload_video(video_path, meta_path):
    client_id = os.environ.get("YT_CLIENT_ID")
    client_secret = os.environ.get("YT_CLIENT_SECRET")
    refresh_token = os.environ.get("YT_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        print("⚠️ Secrets YouTube belum lengkap, melewati proses upload otomatis.")
        return

    actual_video = find_latest_video(video_path)
    if not actual_video:
        print("❌ Tidak ditemukan file video .mp4 hasil render.")
        sys.exit(1)

    meta = load_metadata(meta_path)
    raw_title = meta.get("title") or os.path.splitext(os.path.basename(actual_video))[0].replace("_", " ").replace("-", " ")
    title = raw_title[:90].strip() + " #Shorts"
    desc = meta.get("desc", "Video edukasi & fakta menarik singkat!") + "\n\n" + meta.get("tags", "#Shorts #FaktaUnik #AI")

    print(f"🎬 Mengunggah file: {actual_video} | Judul: {title}")

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=["https://www.googleapis.com/auth/youtube.upload"]
    )

    youtube = build("youtube", "v3", credentials=creds)

    body = {
        "snippet": {
            "title": title,
            "description": desc,
            "tags": ["Shorts", "FaktaUnik", "AI"],
            "categoryId": "27"
        },
        "status": {
            "privacyStatus": "private",
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload(actual_video, chunksize=-1, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()

    video_id = response.get("id")
    print(f"🚀 Sukses upload ke YouTube! Link: https://youtube.com/shorts/{video_id}")

if __name__ == "__main__":
    vid = sys.argv[1] if len(sys.argv) > 1 else "output.mp4"
    meta = sys.argv[2] if len(sys.argv) > 2 else "data.json"
    upload_video(vid, meta)
