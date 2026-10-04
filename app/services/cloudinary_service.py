import logging
from time import perf_counter
from typing import Tuple

import cloudinary
import cloudinary.uploader

from app import config

logger = logging.getLogger(__name__)


class CloudinaryConfigurationError(RuntimeError):
    """Raised when Cloudinary credentials are incomplete."""


cloudinary.config(
    cloud_name=config.CLOUDINARY_CLOUD_NAME,
    api_key=config.CLOUDINARY_API_KEY,
    api_secret=config.CLOUDINARY_API_SECRET,
)


def upload_image(file_bytes: bytes) -> Tuple[str, str]:
    missing = [
        name
        for name, value in (
            ("CLOUDINARY_CLOUD_NAME", config.CLOUDINARY_CLOUD_NAME),
            ("CLOUDINARY_API_KEY", config.CLOUDINARY_API_KEY),
            ("CLOUDINARY_API_SECRET", config.CLOUDINARY_API_SECRET),
        )
        if not value
    ]
    if missing:
        raise CloudinaryConfigurationError(
            "Missing Cloudinary environment variable(s): " + ", ".join(missing)
        )

    started = perf_counter()
    result = cloudinary.uploader.upload(file_bytes)
    logger.info("Cloudinary upload completed in %.2fs", perf_counter() - started)
    return result["secure_url"], result["public_id"]
