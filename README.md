# Image Number Detection API

NestJS API for uploading images, extracting every detected digit sequence, and searching stored images by number.

## Backend setup

Requirements: Node.js 20 or newer and npm.

```sh
cd backend
npm install
cp ../.env.example ../.env
npm run start:dev
```

Fill in the Cloudinary values in `.env` and set `FIREBASE_CREDENTIALS_PATH` to a Firebase service-account JSON file. The API defaults to port `8000`. PP-OCRv5 English mobile models initialize at startup and download/cache model files on the first run, so first startup needs network access.

The backend uses NestJS, Cloudinary, Firebase Admin/Firestore, and PaddleOCR PP-OCRv5 English mobile models through ONNX Runtime. OCR runs locally in the backend; image bytes are not sent to a hosted OCR service. It scans a tight crop around the usual center-chest bib position first and falls back to full-image OCR when it cannot identify a five-digit bib.

## API

- `POST /images` — multipart field `file`; returns `{ id, numbers, number, image_url }`
- `POST /images/bulk` — repeat multipart field `files`; accepts up to 10 images and returns `{ total, successful, failed, items, errors }`
- `GET /images?number=1234` — list records where any detected number contains `1234`
- `GET /images/all?page=1&limit=20` — get a page of all records, newest first; returns `{ items, page, limit, total, totalPages }` (limit max: 100)
- `GET /images/{id}` — fetch one record

Uploads accept up to 20 MiB per image. The bulk endpoint processes up to three images at a time and reports per-file failures alongside successful results. OCR and Cloudinary upload run concurrently for each image; OCR errors still allow an image to be saved with an empty `numbers` array. When a five-digit bib is recognized, the record stores bib candidates in `numbers` and uses the first one as `number`; otherwise it stores the OCR digit sequences as a fallback. Search supports substring matching, including for records created by the previous version.

## Frontend

```sh
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL` in `frontend/.env` if the API is not at `http://localhost:8000`.

The previous Python implementation remains in `app/` as a migration reference.
