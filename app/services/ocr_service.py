import re
import logging
from time import perf_counter
from typing import Optional

import cv2
import numpy as np

try:
    from paddleocr import PaddleOCR
except ImportError as exc:  # Keep the API importable until dependencies are installed.
    PaddleOCR = None
    _paddleocr_import_error = exc
else:
    _paddleocr_import_error = None


_reader = None
logger = logging.getLogger(__name__)


def _get_reader():
    global _reader
    if _reader is None:
        started = perf_counter()
        if PaddleOCR is None:
            raise RuntimeError(
                "PaddleOCR is not installed. Run: "
                "pip install paddlepaddle==3.0.0 paddleocr"
            ) from _paddleocr_import_error

        _reader = PaddleOCR(
            lang="en",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="en_PP-OCRv5_mobile_rec",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
        )
        logger.info("OCR model initialized in %.2fs", perf_counter() - started)
    return _reader


def warm_up() -> None:
    """Load the OCR model before the first upload request."""
    _get_reader()


def extract_number(image_bytes: bytes) -> Optional[str]:
    started = perf_counter()
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None

    ocr_started = perf_counter()
    texts = []
    for result in _get_reader().predict(image):
        data = result.json
        data = data.get("res", data)
        texts.extend(data.get("rec_texts", []))
    logger.info(
        "OCR completed in %.2fs (total %.2fs, image_bytes=%d, size=%dx%d)",
        perf_counter() - ocr_started,
        perf_counter() - started,
        len(image_bytes),
        image.shape[1],
        image.shape[0],
    )

    matches = re.findall(r"\d+", " ".join(texts))
    if not matches:
        return None
    return max(matches, key=len)
