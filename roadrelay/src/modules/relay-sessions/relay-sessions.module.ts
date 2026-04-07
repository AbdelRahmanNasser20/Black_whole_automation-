import { Module } from '@nestjs/common';

import { RelaySessionsController } from './relay-sessions.controller';
import { RelaySessionsService } from './relay-sessions.service';
import { UnitOfWork } from '@infrastructure/database/unit-of-work';

@Module({
  controllers: [RelaySessionsController],
  providers: [RelaySessionsService, UnitOfWork],
  exports: [RelaySessionsService, UnitOfWork],
})
export class RelaySessionsModule {}
