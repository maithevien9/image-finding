import { Module } from '@nestjs/common';
import { ImagesModule } from './images/images.module';
import { OcrModule } from './ocr/ocr.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { FirestoreModule } from './firestore/firestore.module';

@Module({
  imports: [OcrModule, CloudinaryModule, FirestoreModule, ImagesModule],
})
export class AppModule {}
