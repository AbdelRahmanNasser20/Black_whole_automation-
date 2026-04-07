import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { VehiclesModule } from '@modules/vehicles/vehicles.module';

@Module({
  imports: [VehiclesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
