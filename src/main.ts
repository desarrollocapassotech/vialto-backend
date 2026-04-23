import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'https://vialto-frontend.onrender.com',
      'https://registro-combustible-logistica.web.app',
      'https://registro-combustible-logistica.firebaseapp.com',
      /localhost:\d+/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  console.log(`[vialto-backend] Servidor corriendo en puerto ${port}`);
  console.log(`[vialto-backend] NODE_ENV: ${process.env.NODE_ENV}`);
}

bootstrap().catch((err) => {
  Sentry.captureException(err);
  console.error(err);
  process.exit(1);
});
