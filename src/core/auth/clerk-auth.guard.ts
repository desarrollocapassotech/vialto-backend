import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

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
        /** Session tokens v2 (Clerk): org en objeto `o` */
        o?: { id?: string; rol?: string };
      };

      const p = payload as unknown as {
        public_metadata?: { vialtoRole?: string };
        /** Si personalizás el session token con `metadata: "{{user.public_metadata}}"` */
        metadata?: { vialtoRole?: string };
      };

      const metaRole =
        p.public_metadata?.vialtoRole ?? p.metadata?.vialtoRole;

      const tenantId = claims.org_id ?? claims.o?.id ?? null;

      const orgRoleClaim =
        claims.org_role ??
        (claims.o?.rol ? `org:${claims.o.rol}` : undefined);

      request.auth = {
        userId: claims.sub,
        tenantId,
        role:
          metaRole === 'superadmin'
            ? 'superadmin'
            : normalizeRole(orgRoleClaim),
      } satisfies AuthPayload;

      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
