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

function corsOriginMatchers(): (string | RegExp)[] {
  const fromEnv = (process.env.CORS_ORIGINS?.split(',') ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    'https://vialto-frontend.onrender.com',
    'https://admin.vialto.uno',
    'https://www.admin.vialto.uno',
    'https://registro-combustible-logistica.web.app',
    'https://registro-combustible-logistica.firebaseapp.com',
    /localhost:\d+/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ...fromEnv,
  ];
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return corsOriginMatchers().some((rule) =>
    typeof rule === 'string' ? rule === origin : rule.test(origin),
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(null, isOriginAllowed(origin) ? origin : false);
    },
    credentials: true,
    /** Sin lista fija: el preflight puede pedir cabeceras extra (p. ej. Sentry, Clerk). El paquete `cors` replica `Access-Control-Request-Headers`. */
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
