import { Module } from '@nestjs/common';

import { PlatesController } from './plates.controller';
import { PlatesService } from './plates.service';
import { AbuseDetectionService } from './abuse-detection.service';
import { TrustScoreService } from './trust-score.service';
import { VehiclesModule } from '@modules/vehicles/vehicles.module';

@Module({
  imports: [VehiclesModule],
  controllers: [PlatesController],
  providers: [PlatesService, AbuseDetectionService, TrustScoreService],
  exports: [PlatesService, AbuseDetectionService, TrustScoreService],
})
export class PlatesModule {}
