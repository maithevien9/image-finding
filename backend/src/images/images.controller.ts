import {
  Controller,
  BadRequestException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { OcrService } from '../ocr/ocr.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FirestoreService } from '../firestore/firestore.service';

const imageFileFilter = (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
  if (!file.mimetype.startsWith('image/')) {
    callback(new HttpException('Choose image files only.', HttpStatus.BAD_REQUEST), false);
    return;
  }
  callback(null, true);
};

@Controller('images')
export class ImagesController {
  private readonly logger = new Logger(ImagesController.name);

  constructor(
    private readonly ocr: OcrService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly firestore: FirestoreService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: imageFileFilter,
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new HttpException('Upload an image in the "file" field.', HttpStatus.BAD_REQUEST);
    }
    return this.processImage(file);
  }

  @Post('bulk')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 10 },
      fileFilter: imageFileFilter,
    }),
  )
  async uploadMany(@UploadedFiles() files?: Express.Multer.File[]) {
    if (!files?.length) {
      throw new HttpException('Upload one or more images in the "files" field.', HttpStatus.BAD_REQUEST);
    }

    let nextIndex = 0;
    const outcomes: Array<{
      filename: string;
      result?: Awaited<ReturnType<ImagesController['processImage']>>;
      error?: string;
    }> = new Array(files.length);
    const workerCount = Math.min(3, files.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        const file = files[index];
        try {
          outcomes[index] = { filename: file.originalname, result: await this.processImage(file) };
        } catch (error) {
          outcomes[index] = {
            filename: file.originalname,
            error: error instanceof Error ? error.message : 'Image processing failed.',
          };
        }
      }
    }));

    const items = outcomes.flatMap((outcome) => outcome.result ? [outcome.result] : []);
    const errors = outcomes.flatMap((outcome) => outcome.error
      ? [{ filename: outcome.filename, error: outcome.error }]
      : []);
    return { total: files.length, successful: items.length, failed: errors.length, items, errors };
  }

  private async processImage(file: Express.Multer.File) {
    const started = performance.now();
    this.logger.log(`Upload received: filename=${file.originalname} size_bytes=${file.size}`);

    const [ocrResult, uploadResult] = await Promise.allSettled([
      this.measureStage('detect_number', () => this.ocr.extractNumbers(file.buffer)),
      this.measureStage('cloudinary', () => this.cloudinaryService.uploadImage(file.buffer)),
    ]);

    const numbers = ocrResult.status === 'fulfilled' ? ocrResult.value : [];
    if (ocrResult.status === 'rejected') {
      this.logger.error('OCR failed; saving image without a detected number', ocrResult.reason?.stack);
    }
    if (!numbers.length) this.logger.warn(`No number detected in uploaded image ${file.originalname}`);

    if (uploadResult.status === 'rejected') {
      const reason = uploadResult.reason;
      const details = reason instanceof Error ? reason.message : String(reason);
      this.logger.error(`Cloudinary upload failed for ${file.originalname}: ${details}`);
      if (uploadResult.reason instanceof ServiceUnavailableException) throw uploadResult.reason;
      throw new HttpException(`Image upload failed: ${details}`, HttpStatus.BAD_GATEWAY);
    }

    try {
      const firestoreStarted = performance.now();
      const id = await this.firestore.saveRecord(numbers, uploadResult.value.imageUrl, uploadResult.value.publicId);
      this.logger.log(`Upload stage=firestore elapsed=${((performance.now() - firestoreStarted) / 1000).toFixed(2)}s`);
      this.logger.log(`Upload completed elapsed=${((performance.now() - started) / 1000).toFixed(2)}s`);
      return {
        id,
        filename: file.originalname,
        numbers,
        number: numbers[0] ?? null,
        image_url: uploadResult.value.imageUrl,
      };
    } catch (error) {
      this.logger.error('Firestore save failed', error instanceof Error ? error.stack : String(error));
      throw new HttpException('Could not save image record.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async measureStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.logger.log(`Upload stage=${stage} elapsed=${((performance.now() - started) / 1000).toFixed(2)}s`);
    }
  }

  @Get()
  async search(@Query('number') number?: string) {
    if (!number) throw new HttpException('The number query parameter is required.', HttpStatus.BAD_REQUEST);
    return this.firestore.searchByNumber(number);
  }

  @Get('all')
  async getAll(@Query('page') pageParam?: string, @Query('limit') limitParam?: string) {
    const page = this.parsePaginationValue('page', pageParam, 1, Number.MAX_SAFE_INTEGER);
    const limit = this.parsePaginationValue('limit', limitParam, 20, 100);
    return this.firestore.getAll(page, limit);
  }

  private parsePaginationValue(name: string, value: string | undefined, fallback: number, max: number) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`${name} must be an integer between 1 and ${max}.`);
    }
    return parsed;
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const record = await this.firestore.getById(id);
    if (!record) throw new NotFoundException('Image not found');
    return record;
  }
}
