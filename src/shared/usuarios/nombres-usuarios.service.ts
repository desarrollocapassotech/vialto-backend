import { Injectable, Logger } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

/**
 * Nombre visible de usuarios de Clerk a partir de su id (los `createdBy`): "Nombre Apellido",
 * o el mail si no tiene nombre. Mismo criterio que la auditoría de superadmin. Si Clerk falla
 * no rompe a quien lo usa: devuelve lo que pudo resolver.
 */
@Injectable()
export class NombresUsuariosService {
  private readonly logger = new Logger(NombresUsuariosService.name);
  private readonly clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  async nombres(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id) => id?.startsWith('user_')))];
    const resultado = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      try {
        const r = await this.clerk.users.getUserList({ userId: ids.slice(i, i + 100), limit: 100 });
        for (const u of Array.isArray(r) ? r : r.data) {
          const nombre = [u.firstName, u.lastName].filter(Boolean).join(' ');
          resultado.set(u.id, nombre || u.emailAddresses?.[0]?.emailAddress || 'Usuario');
        }
      } catch (e) {
        this.logger.warn(`No se pudieron traer nombres de Clerk: ${e}`);
      }
    }
    return resultado;
  }
}
