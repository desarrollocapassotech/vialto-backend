import { Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

/**
 * Resuelve `public_metadata.vialtoRole` cuando no viene en el JWT.
 * Usa caché en memoria para no llamar a la API de Clerk en cada request.
 */
@Injectable()
export class ClerkVialtoRoleService {
  private readonly clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? '',
  });

  private readonly cache = new Map<
    string,
    { value: string | undefined; at: number }
  >();

  private readonly ttlMs = 5 * 60 * 1000;

  /** IDs de usuario Clerk (separados por coma) con rol superadmin — sin llamada a API. */
  isEnvSuperadmin(userId: string): boolean {
    const raw = process.env.SUPERADMIN_CLERK_USER_IDS ?? '';
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.includes(userId);
  }

  /**
   * Obtiene `vialtoRole` desde la API de Clerk (con caché).
   * Si `CLERK_SECRET_KEY` falta o falla la API, devuelve `undefined`.
   */
  async getVialtoRoleFromApi(userId: string): Promise<string | undefined> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    if (hit && now - hit.at < this.ttlMs) {
      return hit.value;
    }

    if (!process.env.CLERK_SECRET_KEY) {
      return undefined;
    }

    try {
      const user = await this.clerk.users.getUser(userId);
      const raw = user.publicMetadata?.vialtoRole;
      const value = typeof raw === 'string' ? raw : undefined;
      this.cache.set(userId, { value, at: now });
      return value;
    } catch {
      return undefined;
    }
  }
}
