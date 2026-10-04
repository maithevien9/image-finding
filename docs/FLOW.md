# Flow

## Upload (`POST /images`)

1. NestJS reads multipart field `file` into memory and checks that its MIME type is an image.
2. The OCR service uses the faster PP-OCRv5 English mobile model to scan a center bib crop first and retries a slight horizontal shift when needed. If it finds a five-digit bib, it returns that candidate without scanning the full frame; otherwise it scans the full image and returns all OCR digit sequences as a fallback. This avoids background text and dates on typical race photos while reducing OCR time.
3. OCR and Cloudinary upload run concurrently. An OCR error is logged and the image is still uploaded with `numbers: []`.
4. Firestore stores `{numbers, number, image_url, public_id, created_at}` in the `images` collection. `number` remains the first detected value for compatibility.
5. The API returns `{id, numbers, number, image_url}`.

The server logs timings and average OCR confidence for each OCR stage. PaddleOCR initializes its ONNX models during application startup; the first launch downloads and caches model files.

## Bulk upload (`POST /images/bulk`)

Send up to 10 images using repeated multipart `files` fields. The API processes up to three images concurrently and returns `{total, successful, failed, items, errors}` so partial failures are reported per filename.

## Search (`GET /images?number=1234`)

The API returns records where any detected number contains the requested query string. To support substring matching and old records, it scans the `images` collection and filters in the API.

## List (`GET /images/all?page=1&limit=20`)

Returns the requested page of all records ordered by `created_at` descending, plus `total` and `totalPages` metadata. Page defaults to 1, limit defaults to 20, and limit is capped at 100.

## Read (`GET /images/{id}`)

The API looks up one Firestore document and returns 404 if it does not exist.

## NestJS files

| Purpose | File |
| --- | --- |
| Bootstrap and CORS | `backend/src/main.ts` |
| Upload and search routes | `backend/src/images/images.controller.ts` |
| OCR | `backend/src/ocr/ocr.service.ts` |
| Cloudinary | `backend/src/cloudinary/cloudinary.service.ts` |
| Firestore | `backend/src/firestore/firestore.service.ts` |
