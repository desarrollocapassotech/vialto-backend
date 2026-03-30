import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { ClerkVialtoRoleService } from './clerk-vialto-role.service';

export interface AuthPayload {
  userId: string;
  tenantId: string | null;
  role: string | null;
}

function normalizeRole(orgRole: string | undefined): string | null {
  if (!orgRole) return null;
  if (orgRole === 'org:admin') return 'admin';
  if (orgRole === 'org:supervisor') return 'supervisor';
  if (orgRole === 'org:member') return 'operador';
  return orgRole.replace(/^org:/, '');
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly vialtoRoleService: ClerkVialtoRoleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token requerido');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });

      const claims = payload as unknown as {
        sub: string;
        org_id?: string;
        org_role?: string;
        o?: { id?: string; rol?: string };
      };

      const p = payload as unknown as {
        public_metadata?: { vialtoRole?: string };
        metadata?: { vialtoRole?: string };
      };

      let vialtoRole =
        p.public_metadata?.vialtoRole ?? p.metadata?.vialtoRole;

      if (vialtoRole == null) {
        vialtoRole = await this.vialtoRoleService.getVialtoRoleFromApi(
          claims.sub,
        );
      }

      if (this.vialtoRoleService.isEnvSuperadmin(claims.sub)) {
        vialtoRole = 'superadmin';
      }

      const tenantId = claims.org_id ?? claims.o?.id ?? null;

      const orgRoleClaim =
        claims.org_role ??
        (claims.o?.rol ? `org:${claims.o.rol}` : undefined);

      const role: string | null =
        vialtoRole === 'superadmin'
          ? 'superadmin'
          : normalizeRole(orgRoleClaim);

      request.auth = {
        userId: claims.sub,
        tenantId,
        role,
      } satisfies AuthPayload;

      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
