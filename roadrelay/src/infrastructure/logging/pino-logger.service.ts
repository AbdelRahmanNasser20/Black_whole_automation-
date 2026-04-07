import { LoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';

/**
 * Centralised structured logger. Sensitive paths are redacted to avoid
 * accidentally writing PII to logs.
 */
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'roadrelay' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'phone',
          'phoneNumber',
          'phone_number',
          'phone_number_e164',
          'otp',
          'code',
          '*.phoneNumber',
          '*.phone_number',
        ],
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.logger.info({ optional }, String(message));
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.logger.error({ optional }, String(message));
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.logger.warn({ optional }, String(message));
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.logger.debug({ optional }, String(message));
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.logger.trace({ optional }, String(message));
  }
}
