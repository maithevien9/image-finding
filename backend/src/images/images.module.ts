import { Module } from '@nestjs/common';
import { ImagesController } from './images.controller';
import { OcrModule } from '../ocr/ocr.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { FirestoreModule } from '../firestore/firestore.module';

@Module({
  imports: [OcrModule, CloudinaryModule, FirestoreModule],
  controllers: [ImagesController],
})
export class ImagesModule {}
