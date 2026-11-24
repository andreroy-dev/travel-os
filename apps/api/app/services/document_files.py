"""Private storage for uploaded travel documents (passport scans, insurance PDFs, permits).

Files live under UPLOAD_DIR/documents/<user id>/ and are only ever served to their owner
through an authenticated endpoint. Swap this module for S3 when hosting (PRD 6.1).
"""

import shutil
import uuid
from pathlib import Path

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


def save(user_id: uuid.UUID, raw: bytes, declared: str | None, name: str) -> tuple[str, str, int]:
    if not raw:
        raise AppError(422, "That file is empty.")
    if len(raw) > MAX_BYTES:
        raise AppError(413, "Files can be up to 15 MB.")
    content_type = _kind(raw, declared, name)
    folder = _root() / user_id.hex
    folder.mkdir(parents=True, exist_ok=True)
    key = f"{user_id.hex}/{uuid.uuid4().hex}{ALLOWED[content_type]}"
    (_root() / key).write_bytes(raw)
    return key, content_type, len(raw)


def path_for(key: str) -> Path:
    path = (_root() / key).resolve()
    if _root() not in path.parents or not path.is_file():
        raise AppError(404, "That file is no longer available.")
    return path


def delete(key: str | None) -> None:
    if not key:
        return
    try:
        path_for(key).unlink(missing_ok=True)
    except AppError:
        pass


def delete_all(user_id: uuid.UUID) -> None:
    shutil.rmtree(_root() / user_id.hex, ignore_errors=True)
