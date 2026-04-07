import { Module } from '@nestjs/common';
import { ExpirationsJob } from './expirations.job';
import { AnomalyDetectionJob } from './anomaly-detection.job';
import { PlatesModule } from '@modules/plates/plates.module';

@Module({
  imports: [PlatesModule],
  providers: [ExpirationsJob, AnomalyDetectionJob],
})
export class JobsModule {}
