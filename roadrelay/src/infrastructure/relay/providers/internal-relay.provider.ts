import { Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  CloseRelaySessionInput,
  IRelayProvider,
  OpenRelaySessionInput,
  OpenRelaySessionResult,
} from '../tokens';

/**
 * The internal provider doesn't bridge to any external network. It just
 * issues a synthetic session id and relies on our own message store
 * (relay_events table) for delivery. This is what the MVP ships with.
 */
export class InternalRelayProvider implements IRelayProvider {
  private readonly logger = new Logger('InternalRelayProvider');

  async open(input: OpenRelaySessionInput): Promise<OpenRelaySessionResult> {
    const id = `int_${ulid()}`;
    this.logger.log(
      `[internal-relay] open session=${id} cr=${input.contactRequestId} ttl=${input.ttlSeconds}`,
    );
    return {
      providerSessionId: id,
      metadata: {
        provider: 'internal',
        opened_at: new Date().toISOString(),
      },
    };
  }

  async close(input: CloseRelaySessionInput): Promise<void> {
    this.logger.log(
      `[internal-relay] close session=${input.providerSessionId} reason=${input.reason}`,
    );
  }
}
