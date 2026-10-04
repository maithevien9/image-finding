import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ImageRecord {
  id: string;
  numbers: string[];
  /** First detected number, retained for clients using the original response shape. */
  number: string | null;
  image_url: string;
  public_id: string;
  created_at: string;
}

export interface PaginatedImageRecords {
  items: ImageRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class FirestoreService implements OnModuleInit {
  private readonly logger = new Logger(FirestoreService.name);
  private db?: Firestore;

  onModuleInit() {
    if (getApps().length) {
      this.db = getFirestore();
      return;
    }
    const credentialPath = process.env.FIREBASE_CREDENTIALS_PATH;
    if (credentialPath) {
      // The API is commonly launched from backend/, while credentials and the
      // root .env file live one directory above it. Accept either base path.
      const candidates = [
        resolve(process.cwd(), credentialPath),
        resolve(process.cwd(), '..', credentialPath),
      ];
      const resolvedPath = candidates.find((candidate) => existsSync(candidate));
      if (!resolvedPath) {
        throw new Error(
          `Firebase service-account file not found. Checked: ${candidates.join(', ')}`,
        );
      }
      initializeApp({ credential: cert(resolvedPath) });
    } else {
      initializeApp({ credential: applicationDefault() });
    }
    this.db = getFirestore();
  }

  private collection() {
    if (!this.db) throw new Error('Firestore is not initialized');
    return this.db.collection('images');
  }

  async saveRecord(numbers: string[], imageUrl: string, publicId: string): Promise<string> {
    const started = performance.now();
    const ref = this.collection().doc();
    await ref.set({
      numbers,
      number: numbers[0] ?? null,
      image_url: imageUrl,
      public_id: publicId,
      created_at: new Date().toISOString(),
    });
    this.logger.log(`Firestore save completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
    return ref.id;
  }

  async searchByNumber(number: string): Promise<ImageRecord[]> {
    const query = number.trim();
    const snapshot = await this.collection().get();
    return snapshot.docs.flatMap((doc) => {
      const data = doc.data();
      // Older documents only have a single `number`; new documents store all
      // OCR results in `numbers`. Search with substring semantics for both.
      const detected = Array.isArray(data.numbers)
        ? data.numbers.filter((value): value is string => typeof value === 'string')
        : typeof data.number === 'string' ? [data.number] : [];
      if (!detected.some((value) => value.includes(query))) return [];
      return [this.toImageRecord(doc.id, data, detected)];
    });
  }

  async getAll(page: number, limit: number): Promise<PaginatedImageRecords> {
    const collection = this.collection();
    const [snapshot, countSnapshot] = await Promise.all([
      collection.orderBy('created_at', 'desc').offset((page - 1) * limit).limit(limit).get(),
      collection.count().get(),
    ]);
    const total = countSnapshot.data().count;
    return {
      items: snapshot.docs.map((doc) => {
        const data = doc.data();
        const numbers = Array.isArray(data.numbers)
          ? data.numbers.filter((value): value is string => typeof value === 'string')
          : typeof data.number === 'string' ? [data.number] : [];
        return this.toImageRecord(doc.id, data, numbers);
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private toImageRecord(
    id: string,
    data: FirebaseFirestore.DocumentData,
    numbers: string[],
  ): ImageRecord {
    return { id, ...data, numbers, number: numbers[0] ?? null } as ImageRecord;
  }

  async getById(id: string): Promise<ImageRecord | null> {
    const doc = await this.collection().doc(id).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as ImageRecord) : null;
  }
}
