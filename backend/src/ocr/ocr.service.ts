import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PaddleOcrService as PaddleOcrServiceType } from 'ppu-paddle-ocr';

// ppu-paddle-ocr is ESM-only while this Nest app currently builds as CommonJS.
// Keep the import dynamic so Node can load its ESM entry point at runtime.
const loadPaddleOcr = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('ppu-paddle-ocr')>;
const loadCanvas = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@napi-rs/canvas')>;

@Injectable()
export class OcrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private engine?: PaddleOcrServiceType;

  async onModuleInit() {
    const started = performance.now();
    const { PaddleOcrService, V5_EN_MOBILE_MODEL } = await loadPaddleOcr('ppu-paddle-ocr');

    this.engine = new PaddleOcrService({
      model: V5_EN_MOBILE_MODEL,
      debugging: { verbose: false, debug: false },
    });

    this.logger.log('Loading PP-OCRv5 English mobile models; first startup downloads and caches model files.');
    await this.engine.initialize();
    this.logger.log(`PP-OCRv5 mobile initialized in ${((performance.now() - started) / 1000).toFixed(2)}s`);
  }

  async onModuleDestroy() {
    await this.engine?.destroy();
  }

  async extractNumbers(image: Buffer): Promise<string[]> {
    if (!this.engine) throw new Error('PaddleOCR engine is not initialized');

    const imageData = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;
    const croppedImage = await this.createCenterBibCrop(image, 0.504);
    const firstCropResult = await this.recognizeTimed('bib-crop-center', croppedImage);
    let cropResults = [firstCropResult];
    let bibCandidates = this.extractDigitSequences(firstCropResult.text);

    // Slightly shifting the crop recovers a clipped first digit on off-center bibs.
    if (!bibCandidates.some((value) => value.length === 5)) {
      const shiftedCrop = await this.createCenterBibCrop(image, 0.48);
      const shiftedResult = await this.recognizeTimed('bib-crop-shifted', shiftedCrop);
      cropResults = [...cropResults, shiftedResult];
      bibCandidates = cropResults.flatMap((result) => this.extractDigitSequences(result.text));
    }

    const primaryBibCandidates = bibCandidates.filter((value) => value.length === 5);
    if (primaryBibCandidates.length) return [...new Set(primaryBibCandidates)];

    // Skip full-frame OCR for the common bib case. It is slower and often
    // returns unrelated digits from signs and dates in the background.
    const fullResult = await this.recognizeTimed('full-image-fallback', imageData);
    return [...new Set([
      ...bibCandidates,
      ...this.extractDigitSequences(fullResult.text),
    ])];
  }

  private async recognizeTimed(imageType: string, image: ArrayBuffer) {
    const started = performance.now();
    const result = await this.engine!.recognize(image);
    const numbers = this.extractDigitSequences(result.text);
    this.logger.log(
      `PP-OCRv5 ${imageType} inference elapsed=${((performance.now() - started) / 1000).toFixed(2)}s confidence=${result.confidence.toFixed(3)} number_candidates=${numbers.length}`,
    );
    return result;
  }

  private extractDigitSequences(text: string): string[] {
    return [...new Set(text.match(/\d+/g) ?? [])];
  }

  private async createCenterBibCrop(image: Buffer, centerX: number): Promise<ArrayBuffer> {
    const { createCanvas, loadImage } = await loadCanvas('@napi-rs/canvas');
    const decoded = await loadImage(image);
    const cropWidth = Math.max(1, Math.floor(decoded.width * 0.134));
    const cropHeight = Math.max(1, Math.floor(decoded.height * 0.116));
    const cropX = Math.max(0, Math.round(decoded.width * centerX - cropWidth / 2));
    const cropY = Math.max(0, Math.ceil(decoded.height * 0.583 - cropHeight / 2));
    const canvas = createCanvas(cropWidth, cropHeight);

    canvas.getContext('2d').drawImage(
      decoded,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    const cropped = canvas.toBuffer('image/png');
    return cropped.buffer.slice(
      cropped.byteOffset,
      cropped.byteOffset + cropped.byteLength,
    ) as ArrayBuffer;
  }
}
