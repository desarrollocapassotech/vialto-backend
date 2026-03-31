import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { MODULE_KEY } from '../decorators/require-module.decorator';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredModule) return true;

    const auth = context.switchToHttp().getRequest().auth as {
      role?: string | null;
      tenantId?: string | null;
    };

    /** Superadmin puede auditar cualquier org sin depender de módulos habilitados. */
    if (auth.role === 'superadmin') return true;

    const { tenantId } = auth;
    if (!tenantId) throw new ForbiddenException('Tenant no identificado');

    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });

    if (!tenant?.modules?.includes(requiredModule)) {
      throw new ForbiddenException(`El módulo '${requiredModule}' no está habilitado para este tenant`);
    }

    return true;
  }
}
