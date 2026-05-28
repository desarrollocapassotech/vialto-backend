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
    const requiredModules = this.reflector.getAllAndOverride<string[]>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredModules || requiredModules.length === 0) return true;

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

    const tieneAlguno = requiredModules.some((m) => tenant?.modules?.includes(m));
    if (!tieneAlguno) {
      throw new ForbiddenException(`Se requiere alguno de los módulos: ${requiredModules.join(', ')}`);
    }

    return true;
  }
}
