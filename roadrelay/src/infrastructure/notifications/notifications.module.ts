import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { NOTIFICATION_PROVIDER, SMS_PROVIDER } from './tokens';
import { StubNotificationProvider } from './providers/stub-notification.provider';
import { StubSmsProvider } from './providers/stub-sms.provider';
import { NotificationService } from './notification.service';

/**
 * Notifications are intentionally abstracted to avoid vendor lock-in.
 *
 * To add a new provider:
 *  1. Implement INotificationProvider or ISmsProvider in providers/.
 *  2. Register it in the factory below behind a config flag.
 *
 * Never reference Twilio / FCM / APNs / SES from outside this module.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('storage.notifications.driver');
        switch (driver) {
          case 'stub':
          default:
            return new StubNotificationProvider();
        }
      },
    },
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('storage.notifications.smsDriver');
        switch (driver) {
          case 'stub':
          default:
            return new StubSmsProvider();
        }
      },
    },
    NotificationService,
  ],
  exports: [NotificationService, NOTIFICATION_PROVIDER, SMS_PROVIDER],
})
export class NotificationsModule {}
