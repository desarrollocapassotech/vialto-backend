import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
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

  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  if (swaggerPassword) {
    const swaggerUser = process.env.SWAGGER_USER ?? 'admin';
    app.use('/docs', (req: any, res: any, next: any) => {
      const authHeader: string | undefined = req.headers['authorization'];
      if (!authHeader?.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Vialto API Docs"');
        res.status(401).send('Unauthorized');
        return;
      }
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const sep = decoded.indexOf(':');
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (user !== swaggerUser || pass !== swaggerPassword) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Vialto API Docs"');
        res.status(401).send('Unauthorized');
        return;
      }
      next();
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vialto API')
    .setDescription('API REST del backend SaaS de logística Vialto. Autenticación via JWT de Clerk (Bearer token).')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'clerk-jwt')
    // Sistema
    .addTag('Sistema', 'Health check y dashboard general del tenant')
    // Core — entidades compartidas
    .addTag('Core — Clientes', 'Empresas clientes a las que se les factura')
    .addTag('Core — Choferes', 'Choferes propios y de transportistas externos')
    .addTag('Core — Vehículos', 'Flota de vehículos del tenant')
    .addTag('Core — Transportistas', 'Transportistas externos y propios')
    .addTag('Core — Usuarios', 'Usuarios de la organización (sincronizados con Clerk)')
    // Admin — solo superadmin
    .addTag('Admin — Tenants', 'Alta y configuración de empresas clientes · Solo superadmin')
    .addTag('Admin — Billing', 'Suscripción y módulos activos por tenant · Solo superadmin')
    .addTag('Admin — Platform', 'Vista cross-tenant de todos los datos · Solo superadmin')
    .addTag('Admin — Importaciones', 'Importación masiva de datos desde Excel')
    // Módulos activos
    .addTag('Módulo: Viajes', 'Gestión de viajes · Fase 1 — activo')
    .addTag('Módulo: Viajes — Cargas', 'Cargas asociadas a viajes · Fase 1 — activo')
    .addTag('Módulo: Facturación', 'Facturas y pagos a clientes · Fase 5 — activo')
    .addTag('Módulo: Cuenta Corriente', 'Cuenta corriente por cliente · Fase 2 — activo')
    .addTag('Módulo: Stock', 'Productos y movimientos de stock · Fase 2 — activo')
    // Próximamente
    .addTag('[Próximamente] Remitos', 'Remitos digitales con firma del cliente · Fase 3 — no activo')
    .addTag('[Próximamente] Combustible', 'Control de cargas de combustible por vehículo · Fase 4 — no activo')
    .addTag('[Próximamente] Mantenimiento', 'Intervenciones y alertas de flota · Fase 4 — no activo')
    .addTag('[Próximamente] Turnos', 'Lista de turno para choferes (PWA) · Fase 7 — no activo')
    .addTag('[Próximamente] Reportes', 'Reportes cross-módulo y KPIs · Fase 8 — no activo')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

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
