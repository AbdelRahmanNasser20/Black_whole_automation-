import { Module } from '@nestjs/common';

import { ContactRequestsController } from './contact-requests.controller';
import { ContactRequestsService } from './contact-requests.service';
import { ContentFilterService } from './content-filter.service';
import { PlatesModule } from '@modules/plates/plates.module';
import { RelaySessionsModule } from '@modules/relay-sessions/relay-sessions.module';
import { SafetyModule } from '@modules/safety/safety.module';

@Module({
  imports: [PlatesModule, RelaySessionsModule, SafetyModule],
  controllers: [ContactRequestsController],
  providers: [ContactRequestsService, ContentFilterService],
  exports: [ContactRequestsService],
})
export class ContactRequestsModule {}
