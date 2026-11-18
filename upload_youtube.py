import os
import glob
import json
import sys
import time
import random
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

MAX_RETRIES = 8
RETRIABLE_STATUS = (500, 502, 503, 504)
CHUNK_SIZE = 8 * 1024 * 1024  # 8 MB (kelipatan 256 KB)

def find_latest_video(preferred_path):
    if os.path.exists(preferred_path):
        return preferred_path
    mp4_files = glob.glob("**/*.mp4", recursive=True)
    if not mp4_files:
        return None
    return max(mp4_files, key=os.path.getmtime)

def load_metadata(meta_path):
    def _read(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception as e:
            print(f"⚠️ Gagal membaca metadata {path} ({e}), pakai default.")
            return {}

    if os.path.exists(meta_path):
        return _read(meta_path)
    json_files = [p for p in glob.glob("*.json") if p not in ("package.json", "package-lock.json", "tsconfig.json", "hasil_upload.json")]
    if json_files:
        latest_json = max(json_files, key=os.path.getmtime)
        return _read(latest_json)
    return {}

def parse_jadwal_wib(jadwal_str):
    if not jadwal_str:
        return None
    wib = timezone(timedelta(hours=7))
    formats = ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S")
    for fmt in formats:
        try:
            dt_wib = datetime.strptime(jadwal_str.strip(), fmt).replace(tzinfo=wib)
            dt_utc = dt_wib.astimezone(timezone.utc)
            if dt_utc > datetime.now(timezone.utc):
                return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
            print("⚠️ Jadwal sudah lewat, video diunggah tanpa jadwal.")
            return None
        except ValueError:
            continue
        except Exception as e:
            print(f"⚠️ Format jadwal diabaikan ({e}). Gunakan format YYYY-MM-DD HH:MM")
            return None
    print("⚠️ Format jadwal diabaikan. Gunakan format YYYY-MM-DD HH:MM")
    return None

def normalize_tags_text(tags):
    # Mendukung string "#a #b" maupun list ["a", "#b"]
    if isinstance(tags, list):
        return " ".join(str(t) for t in tags)
    return str(tags) if tags else ""

def build_tag_list(tags_text):
    raw_tags = []
    seen = set()
    for t in tags_text.split():
        clean = t.lstrip("#").strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            raw_tags.append(clean)
    if "shorts" not in seen:
        raw_tags.insert(0, "Shorts")
    # YouTube membatasi total karakter tag ~500
    result, total = [], 0
    for t in raw_tags[:15]:
        total += len(t) + 1
        if total > 480:
            break
        result.append(t)
    return result

def resumable_upload(request):
    response = None
    retry = 0
    last_percent = -1
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                percent = int(status.progress() * 100)
                if percent != last_percent:
                    print(f"⬆️ Progres upload: {percent}%")
                    last_percent = percent
            if response is not None and "id" not in response:
                print(f"❌ Respons tidak terduga dari YouTube: {response}")
                sys.exit(1)
        except HttpError as e:
            if e.resp.status in RETRIABLE_STATUS:
                retry += 1
                if retry > MAX_RETRIES:
                    print(f"❌ Gagal setelah {MAX_RETRIES} percobaan: {e}")
                    sys.exit(1)
                wait = min(60, (2 ** retry) + random.random())
                print(f"🔁 Error server ({e.resp.status}), coba lagi dalam {wait:.1f} detik ({retry}/{MAX_RETRIES})")
                time.sleep(wait)
            else:
                print(f"❌ Upload ditolak YouTube: {e}")
                sys.exit(1)
        except (ConnectionError, TimeoutError, OSError) as e:
            retry += 1
            if retry > MAX_RETRIES:
                print(f"❌ Gagal koneksi setelah {MAX_RETRIES} percobaan: {e}")
                sys.exit(1)
            wait = min(60, (2 ** retry) + random.random())
            print(f"🔁 Koneksi bermasalah ({e}), coba lagi dalam {wait:.1f} detik ({retry}/{MAX_RETRIES})")
            time.sleep(wait)
    return response

def save_result(video_id, title, publish_at):
    url = f"https://youtube.com/shorts/{video_id}"
    hasil = {
        "video_id": video_id,
        "url": url,
        "title": title,
        "publish_at": publish_at,
        "uploaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    try:
        with open("hasil_upload.json", "w", encoding="utf-8") as f:
            json.dump(hasil, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ Gagal menyimpan hasil_upload.json ({e})")

    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        try:
            with open(gh_output, "a", encoding="utf-8") as f:
                f.write(f"video_id={video_id}\n")
                f.write(f"video_url={url}\n")
        except Exception as e:
            print(f"⚠️ Gagal menulis GITHUB_OUTPUT ({e})")

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

    ukuran = os.path.getsize(actual_video)
    if ukuran == 0:
        print(f"❌ File video kosong (0 byte): {actual_video}")
        sys.exit(1)
    print(f"📦 Ukuran video: {ukuran / (1024 * 1024):.2f} MB")

    meta = load_metadata(meta_path)
    raw_title = meta.get("title") or os.path.splitext(os.path.basename(actual_video))[0].replace("_", " ").replace("-", " ")
    title = " ".join(str(raw_title).split())[:90].strip()
    if "#shorts" not in title.lower():
        title += " #Shorts"

    src = meta.get("src", [])
    if isinstance(src, str):
        src = [src]
    sumber_list = [s for s in dict.fromkeys(str(x).strip() for x in src) if s]
    sumber_text = "\n\n📚 Sumber:\n" + "\n".join(f"- {s}" for s in sumber_list) if sumber_list else ""
    tags_text = normalize_tags_text(meta.get("tags", "#Shorts #FaktaUnik #Edukasi")) or "#Shorts #FaktaUnik #Edukasi"
    desc = f"{meta.get('desc', 'Video edukasi & fakta menarik singkat!')}{sumber_text}\n\n{tags_text}"
    desc = desc[:4900]

    raw_tags = build_tag_list(tags_text)

    privasi = os.environ.get("INPUT_PRIVASI", "private").strip().lower()
    if privasi not in ("private", "unlisted", "public"):
        print(f"⚠️ Privasi '{privasi}' tidak valid, pakai 'private'.")
        privasi = "private"

    status_body = {
        "privacyStatus": privasi,
        "selfDeclaredMadeForKids": False,
        "embeddable": True
    }

    publish_at = parse_jadwal_wib(os.environ.get("INPUT_JADWAL", ""))
    if publish_at:
        status_body["privacyStatus"] = "private"  # syarat YouTube untuk video terjadwal
        status_body["publishAt"] = publish_at
        print(f"⏰ Dijadwalkan tayang UTC: {publish_at}")

    print(f"🎬 Mengunggah file: {actual_video} | Judul: {title} | Privasi: {status_body['privacyStatus']}")

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
            "tags": raw_tags,
            "categoryId": "27",
            "defaultLanguage": "id",
            "defaultAudioLanguage": "id"
        },
        "status": status_body
    }

    media = MediaFileUpload(actual_video, chunksize=CHUNK_SIZE, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = resumable_upload(request)

    video_id = response.get("id")
    print(f"🚀 Sukses upload ke YouTube! Link: https://youtube.com/shorts/{video_id}")
    save_result(video_id, title, publish_at)

if __name__ == "__main__":
    vid = sys.argv[1] if len(sys.argv) > 1 else "video_jadi.mp4"
    meta = sys.argv[2] if len(sys.argv) > 2 else "data.json"
    upload_video(vid, meta)
