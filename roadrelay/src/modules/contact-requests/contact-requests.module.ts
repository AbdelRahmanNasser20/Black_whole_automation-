import { Module } from '@nestjs/common';

import { ContactRequestsController } from './contact-requests.controller';
import { ContactRequestsService } from './contact-requests.service';
import { ContentFilterService } from './content-filter.service';
import { VehiclesModule } from '@modules/vehicles/vehicles.module';
import { PlatesModule } from '@modules/plates/plates.module';
import { RelaySessionsModule } from '@modules/relay-sessions/relay-sessions.module';
import { SafetyModule } from '@modules/safety/safety.module';
import { RateLimitService } from '@common/guards/rate-limit.service';

@Module({
  imports: [VehiclesModule, PlatesModule, RelaySessionsModule, SafetyModule],
  controllers: [ContactRequestsController],
  providers: [ContactRequestsService, ContentFilterService, RateLimitService],
  exports: [ContactRequestsService],
})
export class ContactRequestsModule {}
