import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  driver: process.env.STORAGE_DRIVER ?? 's3',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'roadrelay-artifacts',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    presignTtl: parseInt(process.env.S3_PRESIGN_TTL ?? '600', 10),
  },
  notifications: {
    driver: process.env.NOTIFICATION_DRIVER ?? 'stub',
    smsDriver: process.env.SMS_DRIVER ?? 'stub',
    smsFrom: process.env.SMS_FROM ?? '+10000000000',
  },
  relay: {
    driver: process.env.RELAY_DRIVER ?? 'internal',
    sessionTtl: parseInt(process.env.RELAY_SESSION_TTL ?? '86400', 10),
  },
  rateLimits: {
    globalRpm: parseInt(process.env.RATE_LIMIT_GLOBAL_RPM ?? '600', 10),
    authRpm: parseInt(process.env.RATE_LIMIT_AUTH_RPM ?? '10', 10),
    plateLookupRpd: parseInt(process.env.RATE_LIMIT_PLATE_LOOKUP_RPD ?? '30', 10),
    contactReqRpd: parseInt(process.env.RATE_LIMIT_CONTACT_REQ_RPD ?? '10', 10),
  },
}));
