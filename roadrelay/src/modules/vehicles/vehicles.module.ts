import { Module } from '@nestjs/common';

import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehicleVerificationService } from './vehicle-verification.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehicleVerificationService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
