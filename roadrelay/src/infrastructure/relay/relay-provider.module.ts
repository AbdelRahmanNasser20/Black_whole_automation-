import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { RELAY_PROVIDER } from './tokens';
import { InternalRelayProvider } from './providers/internal-relay.provider';

/**
 * The relay provider is responsible for opening / closing a "masked
 * communication" session between two users. In MVP we ship an internal
 * provider that uses our own message store (no PSTN, no SMS bridging).
 *
 * Future drivers can wrap external services such as:
 *   - Twilio Proxy (call/SMS masking)
 *   - Bandwidth.com numbers
 *   - Sinch Voice/SMS
 *
 * The interface (see ./tokens.ts) is intentionally narrow.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RELAY_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('storage.relay.driver');
        switch (driver) {
          case 'internal':
          default:
            return new InternalRelayProvider();
        }
      },
    },
  ],
  exports: [RELAY_PROVIDER],
})
export class RelayProviderModule {}
