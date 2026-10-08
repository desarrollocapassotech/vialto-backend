import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthPayload } from '../../core/auth/clerk-auth.guard';

/**
 * Protege `PlatformController` (`/platform/...`) contra acceso cross-tenant.
 *
 * Esas rutas toman el `tenantId` del request (query, `:tenantId` o body) porque las usa
 * el superadmin para operar sobre cualquier empresa — pero muchas pantallas de tenant
 * también las llaman con su PROPIO `tenantId`. Sin este guard, cualquier usuario logueado
 * podía pasar el `tenantId` de otra empresa y leer/escribir sus datos.
 *
 * Regla: superadmin pasa siempre; cualquier otro rol solo si todo `tenantId` que venga en
 * el request coincide con el de su token. Sin `tenantId` en el request deja pasar (esas
 * rutas ya devuelven lista vacía o 400). Corre después de `ClerkAuthGuard`.
 */
@Injectable()
export class PlatformTenantAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: AuthPayload | undefined = req.auth;
    if (auth?.role === 'superadmin') return true;

    const pedidos = [req.query?.tenantId, req.params?.tenantId, req.body?.tenantId]
      .flat()
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    if (pedidos.length === 0) return true;

    const propio = auth?.tenantId;
    if (!propio || pedidos.some((t) => t !== propio)) {
      throw new ForbiddenException(
        'No tenés permisos para acceder a los datos de esta empresa',
      );
    }
    return true;
  }
}
