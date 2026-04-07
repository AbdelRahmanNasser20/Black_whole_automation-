import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { STORAGE_PROVIDER } from './tokens';
import { S3StorageProvider } from './providers/s3-storage.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('storage.driver');
        switch (driver) {
          case 's3':
          case 'minio':
          default:
            return new S3StorageProvider({
              endpoint: config.get<string>('storage.s3.endpoint'),
              region: config.get<string>('storage.s3.region')!,
              bucket: config.get<string>('storage.s3.bucket')!,
              accessKeyId: config.get<string>('storage.s3.accessKeyId')!,
              secretAccessKey: config.get<string>('storage.s3.secretAccessKey')!,
              presignTtl: config.get<number>('storage.s3.presignTtl')!,
            });
        }
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
