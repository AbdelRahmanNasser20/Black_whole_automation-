import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INotificationProvider,
  ISmsProvider,
  NOTIFICATION_PROVIDER,
  PushPayload,
  SMS_PROVIDER,
  SmsPayload,
} from './tokens';

/**
 * Application-facing facade. Domain code only depends on this class,
 * never on a concrete provider. Add cross-cutting concerns (rate
 * limiting, retries, fan-out, templating) here.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly push: INotificationProvider,
    @Inject(SMS_PROVIDER) private readonly sms: ISmsProvider,
  ) {}

  async pushNotification(payload: PushPayload): Promise<void> {
    try {
      await this.push.send(payload);
    } catch (err) {
      this.logger.error(`Push send failed user=${payload.userId}`, err as Error);
    }
  }

  async sendOtpSms(toPhoneE164: string, code: string): Promise<void> {
    const body = `Your RoadRelay code is ${code}. It expires in 5 minutes. Don't share it with anyone.`;
    await this.sms.send({
      toPhoneE164,
      body,
      correlationId: `otp:${Date.now()}`,
    } satisfies SmsPayload);
  }
}
