import os
import json
import sys
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def upload_video(video_path, meta_path):
    client_id = os.environ.get("YT_CLIENT_ID")
    client_secret = os.environ.get("YT_CLIENT_SECRET")
    refresh_token = os.environ.get("YT_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        print("⚠️ Secrets YouTube belum lengkap, melewati proses upload otomatis.")
        return

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    title = meta.get("title", "Fakta Unik Hari Ini")[:95] + " #Shorts"
    desc = meta.get("desc", "Fakta menarik singkat!") + "\n\n" + meta.get("tags", "#Shorts #FaktaUnik")

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
            "categoryId": "27"  # Education
        },
        "status": {
            "privacyStatus": "private",  # Ubah ke "public" jika ingin langsung tayang publik
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload(video_path, chunksize=-1, resumable=True, mimetype="video/mp4")
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
