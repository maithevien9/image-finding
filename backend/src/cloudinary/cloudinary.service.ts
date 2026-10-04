import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  onModuleInit() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadImage(bytes: Buffer): Promise<{ imageUrl: string; publicId: string }> {
    const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
      .filter((name) => !process.env[name]);
    if (missing.length) throw new ServiceUnavailableException(`Missing Cloudinary configuration: ${missing.join(', ')}`);

    const started = performance.now();
    const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream((error, response) => {
        if (error) {
          const details = this.describeCloudinaryError(error);
          this.logger.error(
            `Cloudinary upload rejected after ${((performance.now() - started) / 1000).toFixed(2)}s: ${details}`,
          );
          reject(new Error(`Cloudinary upload rejected: ${details}`));
        }
        else if (response) resolve(response);
        else reject(new Error('Cloudinary returned an empty upload response'));
      });
      stream.end(bytes);
    });
    this.logger.log(`Cloudinary upload completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
    return { imageUrl: result.secure_url, publicId: result.public_id };
  }

  private describeCloudinaryError(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error);

    const cloudinaryError = error as { name?: unknown; message?: unknown; http_code?: unknown };
    const fields = [
      typeof cloudinaryError.name === 'string' ? cloudinaryError.name : undefined,
      typeof cloudinaryError.http_code === 'number' ? `HTTP ${cloudinaryError.http_code}` : undefined,
      typeof cloudinaryError.message === 'string' ? cloudinaryError.message : undefined,
    ].filter(Boolean);

    return fields.join(': ') || 'Unknown Cloudinary error';
  }
}
