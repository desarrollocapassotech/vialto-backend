import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Si hay tenantId en el token, verifica que exista fila en `tenants`.
 * Sin tenantId (p. ej. operaciones solo superadmin) deja pasar.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const auth = context.switchToHttp().getRequest().auth;
    if (!auth?.tenantId) return true;

    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: auth.tenantId },
      select: { clerkOrgId: true },
    });

    if (!tenant) {
      throw new ForbiddenException(
        'La organización no está registrada en Vialto. Contactá a soporte.',
      );
    }

    return true;
  }
}
