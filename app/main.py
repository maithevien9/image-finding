import asyncio
import logging
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.models import ImageRecord, UploadResponse
from app.services import cloudinary_service, firestore_service, ocr_service

app_logger = logging.getLogger("app")
app_logger.setLevel(logging.INFO)
if not app_logger.handlers:
    log_handler = logging.StreamHandler()
    log_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    app_logger.addHandler(log_handler)
# Keep these application timing records visible with Uvicorn's own logs even
# when its logging config leaves the root logger without a stream handler.
app_logger.propagate = False
logger = logging.getLogger(__name__)


def _run_timed_stage(name, operation, *args):
    started = perf_counter()
    try:
        return operation(*args)
    finally:
        logger.info("Upload stage=%s elapsed=%.2fs", name, perf_counter() - started)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Loading OCR model during application startup")
    ocr_started = perf_counter()
    ocr_service.warm_up()
    logger.info("OCR startup warm-up completed in %.2fs", perf_counter() - ocr_started)
    yield


app = FastAPI(title="Image Number Detection API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.post("/images", response_model=UploadResponse)
async def upload_image(file: UploadFile):
    started = perf_counter()
    file_bytes = await file.read()
    logger.info("Upload received: filename=%s size_bytes=%d", file.filename, len(file_bytes))

    # OCR is CPU-heavy and Cloudinary is network-bound. Run both off the event
    # loop and at the same time so the upload waits for the slower operation,
    # rather than their combined duration.
    ocr_task = asyncio.to_thread(
        _run_timed_stage, "detect_number", ocr_service.extract_number, file_bytes
    )
    cloudinary_task = asyncio.to_thread(
        _run_timed_stage, "cloudinary", cloudinary_service.upload_image, file_bytes
    )
    ocr_result, upload_result = await asyncio.gather(
        ocr_task, cloudinary_task, return_exceptions=True
    )

    if isinstance(ocr_result, BaseException):
        logger.error(
            "OCR failed; saving image without a detected number",
            exc_info=(type(ocr_result), ocr_result, ocr_result.__traceback__),
        )
        number = None
    else:
        number = ocr_result
    if number is None:
        logger.warning("No number detected in uploaded image %s", file.filename)

    if isinstance(upload_result, BaseException):
        if isinstance(upload_result, cloudinary_service.CloudinaryConfigurationError):
            raise HTTPException(status_code=503, detail=str(upload_result)) from upload_result
        raise upload_result
    image_url, public_id = upload_result
    try:
        record_id = await asyncio.to_thread(
            _run_timed_stage,
            "firestore",
            firestore_service.save_record,
            number,
            image_url,
            public_id,
        )
    except firestore_service.FirebaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    logger.info("Upload completed elapsed=%.2fs", perf_counter() - started)
    return UploadResponse(id=record_id, number=number, image_url=image_url)


@app.get("/images", response_model=list[ImageRecord])
async def search_images(number: str):
    return firestore_service.search_by_number(number)


@app.get("/images/{record_id}", response_model=ImageRecord)
async def get_image(record_id: str):
    record = firestore_service.get_by_id(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return record
