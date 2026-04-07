import { Logger } from '@nestjs/common';
import { ISmsProvider, SmsPayload } from '../tokens';

export class StubSmsProvider implements ISmsProvider {
  private readonly logger = new Logger('StubSmsProvider');

  async send(payload: SmsPayload): Promise<void> {
    // NEVER log the body in production. Stubs are dev-only.
    this.logger.log(`[stub-sms] -> ${maskPhone(payload.toPhoneE164)}: "${payload.body}"`);
  }
}

function maskPhone(p: string): string {
  if (p.length <= 4) return '****';
  return `${p.slice(0, p.length - 4).replace(/./g, '*')}${p.slice(-4)}`;
}
