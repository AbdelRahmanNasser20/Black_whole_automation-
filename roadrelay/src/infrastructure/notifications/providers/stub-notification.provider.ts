import { Logger } from '@nestjs/common';
import { INotificationProvider, PushPayload } from '../tokens';

export class StubNotificationProvider implements INotificationProvider {
  private readonly logger = new Logger('StubNotificationProvider');

  async send(payload: PushPayload): Promise<void> {
    this.logger.log(
      `[stub-push] -> user=${payload.userId} title="${payload.title}" body="${payload.body}"`,
    );
  }
}
