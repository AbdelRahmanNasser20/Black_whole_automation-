import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { appConfig } from '@config/app.config';
import { databaseConfig } from '@config/database.config';
import { redisConfig } from '@config/redis.config';
import { authConfig } from '@config/auth.config';
import { storageConfig } from '@config/storage.config';

import { DatabaseModule } from '@infrastructure/database/database.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { NotificationsModule } from '@infrastructure/notifications/notifications.module';
import { RelayProviderModule } from '@infrastructure/relay/relay-provider.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';

import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { VehiclesModule } from '@modules/vehicles/vehicles.module';
import { PlatesModule } from '@modules/plates/plates.module';
import { ContactRequestsModule } from '@modules/contact-requests/contact-requests.module';
import { RelaySessionsModule } from '@modules/relay-sessions/relay-sessions.module';
import { SafetyModule } from '@modules/safety/safety.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AuditModule } from '@modules/audit/audit.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, databaseConfig, redisConfig, authConfig, storageConfig],
    }),
    ScheduleModule.forRoot(),

    LoggingModule,
    DatabaseModule,
    RedisModule,
    StorageModule,
    NotificationsModule,
    RelayProviderModule,

    AuditModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    PlatesModule,
    ContactRequestsModule,
    RelaySessionsModule,
    SafetyModule,
    AdminModule,
    JobsModule,
  ],
})
export class AppModule {}
