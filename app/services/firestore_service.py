from datetime import datetime, timezone
import logging
from pathlib import Path
from time import perf_counter
from typing import Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore

from app import config

_app = None
_db = None


class FirebaseConfigurationError(RuntimeError):
    """Raised when Firebase Admin credentials are unavailable."""


def _get_db():
    global _app, _db
    if _db is None:
        credential_path = Path(config.FIREBASE_CREDENTIALS_PATH).expanduser()
        if not credential_path.is_file():
            raise FirebaseConfigurationError(
                "Firebase service-account file not found: "
                f"{credential_path.resolve()}. "
                "Set FIREBASE_CREDENTIALS_PATH in .env or add the JSON file."
            )

        cred = credentials.Certificate(str(credential_path))
        _app = firebase_admin.initialize_app(cred)
        _db = firestore.client()
    return _db


COLLECTION = "images"
logger = logging.getLogger(__name__)


def save_record(number: Optional[str], image_url: str, public_id: str) -> str:
    started = perf_counter()
    doc_ref = _get_db().collection(COLLECTION).document()
    doc_ref.set(
        {
            "number": number,
            "image_url": image_url,
            "public_id": public_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    logger.info("Firestore save completed in %.2fs", perf_counter() - started)
    return doc_ref.id


def search_by_number(number: str) -> List[Dict]:
    docs = _get_db().collection(COLLECTION).where("number", "==", number).stream()
    return [{"id": doc.id, **doc.to_dict()} for doc in docs]


def get_by_id(record_id: str) -> Optional[Dict]:
    doc = _get_db().collection(COLLECTION).document(record_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}
