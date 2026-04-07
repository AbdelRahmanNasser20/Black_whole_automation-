import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';
import { RequestIdMiddleware } from '@common/middleware/request-id.middleware';
import { PinoLoggerService } from '@infrastructure/logging/pino-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  app.useLogger(app.get(PinoLoggerService));

  // -------- Security middleware ---------------------------------------
  app.use(helmet());
  app.use(new RequestIdMiddleware().use);
  app.enableCors({
    origin: config.get<string>('app.corsOrigins')?.split(',') ?? '*',
    credentials: true,
  });

  // -------- Validation -----------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  app.setGlobalPrefix('v1');

  // -------- OpenAPI ---------------------------------------------------
  if (config.get<string>('app.env') !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('RoadRelay API')
      .setDescription('Privacy-preserving driver-to-driver contact')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, doc);
  }

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
  Logger.log(`RoadRelay API listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
