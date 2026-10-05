import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ChoferAuthRequest } from '../../core/chofer-auth/chofer-auth.guard';
import {
  OrigenErrorChofer,
  registrarErrorChofer,
  sanitizarBody,
} from '../../core/chofer-auth/chofer-error-log';

/**
 * Guarda en CombustibleSyncErrorLog todo request de la app de choferes que termina en
 * error (validación, regla de negocio, foto rechazada, 500...). Sin esto, un rechazo con
 * conexión solo se veía como un toast en el celular del chofer y no quedaba rastro.
 *
 * No cubre lo que pasa ANTES del interceptor: los 401 del ChoferAuthGuard se registran
 * en el propio guard. Excluye:
 * - los endpoints `errores-sincronizacion` (son el canal de reporte de la app);
 * - el alta con `localId` (reintento de la cola offline): la app ya lo reporta como
 *   `sincronizacion_offline`, con resolución por localId; registrarlo acá lo duplicaría.
 */
@Injectable()
export class ChoferErrorLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<
      ChoferAuthRequest & {
        method: string;
        originalUrl?: string;
        url: string;
        body: unknown;
        query: Record<string, unknown>;
        file?: Express.Multer.File;
      }
    >();

    return next.handle().pipe(
      catchError((error: unknown) => {
        const origen = this.origenDe(req);
        if (!origen || !req.choferAuth) return throwError(() => error);

        const status = error instanceof HttpException ? error.getStatus() : 500;
        const body = sanitizarBody(req.body);
        const payload: Record<string, unknown> = {
          ...body,
          http: {
            metodo: req.method,
            ruta: req.originalUrl ?? req.url,
            status,
            query: req.query,
            ...(req.file
              ? { archivo: { nombre: req.file.originalname, mimetype: req.file.mimetype, bytes: req.file.size } }
              : {}),
          },
        };

        return from(
          registrarErrorChofer(this.prisma, {
            tenantId: req.choferAuth.tenantId,
            choferId: req.choferAuth.sub,
            origen,
            mensaje: mensajeDe(error),
            payload,
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  private origenDe(req: { method: string; url: string; body: unknown }): OrigenErrorChofer | null {
    const path = req.url.split('?')[0];
    if (path.includes('/errores-sincronizacion')) return null;
    if (path.endsWith('/fotos')) return 'foto';
    if (/\/cargas\/[^/]+$/.test(path)) {
      if (req.method === 'PATCH') return 'edicion_carga';
      if (req.method === 'DELETE') return 'eliminacion_carga';
    }
    if (path.endsWith('/cargas') && req.method === 'POST') {
      const localId = (req.body as Record<string, unknown> | undefined)?.['localId'];
      return typeof localId === 'string' && localId ? null : 'carga';
    }
    return 'consulta';
  }
}

function mensajeDe(error: unknown): string {
  if (error instanceof HttpException) {
    const res = error.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(' · ');
    if (typeof message === 'string') return message;
    return error.message;
  }
  return error instanceof Error ? `Error interno: ${error.message}` : 'Error interno';
}
