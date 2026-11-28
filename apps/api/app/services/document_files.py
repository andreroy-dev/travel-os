"""Private storage for uploaded travel documents (passport scans, insurance PDFs, permits).

Files are only ever served to their owner through an authenticated endpoint. Two backends:
- local disk under UPLOAD_DIR/documents/<user id>/ (development, tests);
- a private Supabase Storage bucket, used when SUPABASE_URL and SUPABASE_SERVICE_KEY are set
  (hosted servers lose local disk on every deploy, so production must use this).
"""

import shutil
import uuid
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.errors import AppError

MAX_BYTES = 15 * 1024 * 1024
ALLOWED = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
}


def _root() -> Path:
    return Path(get_settings().upload_dir).resolve() / "documents"


def _kind(raw: bytes, declared: str | None, name: str) -> str:
    """Trust the file's own bytes over the declared type where we can."""
    if raw.startswith(b"%PDF"):
        return "application/pdf"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"\x89PNG"):
        return "image/png"
    if raw[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc"):
        return "image/heic"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp"
    raise AppError(415, "Upload a PDF or a photo (JPG, PNG, HEIC).")


def _remote() -> bool:
    cfg = get_settings()
    return bool(cfg.supabase_url and cfg.supabase_service_key)


def _object_url(key: str) -> str:
    cfg = get_settings()
    return f"{cfg.supabase_url.rstrip('/')}/storage/v1/object/{cfg.storage_bucket}/{key}"


def _headers() -> dict[str, str]:
    key = get_settings().supabase_service_key
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _check(response: httpx.Response, action: str) -> None:
    if response.status_code >= 400:
        raise AppError(502, f"File storage is unavailable ({action}). Try again shortly.")


def save(user_id: uuid.UUID, raw: bytes, declared: str | None, name: str) -> tuple[str, str, int]:
    if not raw:
        raise AppError(422, "That file is empty.")
    if len(raw) > MAX_BYTES:
        raise AppError(413, "Files can be up to 15 MB.")
    content_type = _kind(raw, declared, name)
    key = f"{user_id.hex}/{uuid.uuid4().hex}{ALLOWED[content_type]}"
    if _remote():
        _check(
            httpx.post(_object_url(key), content=raw, headers={**_headers(), "Content-Type": content_type}, timeout=30),
            "upload",
        )
    else:
        (_root() / user_id.hex).mkdir(parents=True, exist_ok=True)
        (_root() / key).write_bytes(raw)
    return key, content_type, len(raw)


def read(key: str) -> bytes:
    if _remote():
        response = httpx.get(_object_url(key), headers=_headers(), timeout=30)
        if response.status_code == 404:
            raise AppError(404, "That file is no longer available.")
        _check(response, "download")
        return response.content
    path = (_root() / key).resolve()
    if _root() not in path.parents or not path.is_file():
        raise AppError(404, "That file is no longer available.")
    return path.read_bytes()


def delete(key: str | None) -> None:
    if not key:
        return
    if _remote():
        try:
            httpx.delete(_object_url(key), headers=_headers(), timeout=30)
        except httpx.HTTPError:
            pass
        return
    path = (_root() / key).resolve()
    if _root() in path.parents:
        path.unlink(missing_ok=True)


def delete_all(user_id: uuid.UUID) -> None:
    """Remove every file a user uploaded (account deletion)."""
    if _remote():
        cfg = get_settings()
        base = cfg.supabase_url.rstrip("/")
        try:
            listing = httpx.post(
                f"{base}/storage/v1/object/list/{cfg.storage_bucket}",
                json={"prefix": user_id.hex, "limit": 1000},
                headers=_headers(),
                timeout=30,
            )
            names = [f"{user_id.hex}/{item['name']}" for item in listing.json()] if listing.status_code < 400 else []
            if names:
                httpx.request(
                    "DELETE",
                    f"{base}/storage/v1/object/{cfg.storage_bucket}",
                    json={"prefixes": names},
                    headers=_headers(),
                    timeout=30,
                )
        except (httpx.HTTPError, ValueError, KeyError):
            pass
        return
    shutil.rmtree(_root() / user_id.hex, ignore_errors=True)
