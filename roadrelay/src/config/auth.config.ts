import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
  },
  otp: {
    length: parseInt(process.env.OTP_LENGTH ?? '6', 10),
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldown: parseInt(process.env.OTP_RESEND_COOLDOWN ?? '60', 10),
  },
  pii: {
    encryptionKey: process.env.PII_ENCRYPTION_KEY ?? '',
    encryptionKeyId: process.env.PII_ENCRYPTION_KEY_ID ?? 'v1',
    phoneHmacSecret: process.env.PHONE_HMAC_SECRET ?? 'dev-hmac-secret',
  },
}));
