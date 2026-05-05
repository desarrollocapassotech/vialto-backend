import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthPayload } from './clerk-auth.guard';

/**
 * Verifica que el usuario solo pueda acceder al recurso de su propio tenant
 * (identificado por el param `:orgId`), salvo que sea superadmin.
 *
 * Debe usarse después de ClerkAuthGuard (requiere que `req.auth` esté poblado).
 */
@Injectable()
export class OwnTenantOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth: AuthPayload = request.auth;
    const orgId: string = request.params.orgId;

    if (auth?.role === 'superadmin' || auth?.tenantId === orgId) {
      return true;
    }

    throw new ForbiddenException('Solo podés acceder a tu propio tenant');
  }
}
