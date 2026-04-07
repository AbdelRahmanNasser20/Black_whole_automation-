import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  name: process.env.APP_NAME ?? 'roadrelay',
  port: parseInt(process.env.PORT ?? '3000', 10),
  baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
}));
