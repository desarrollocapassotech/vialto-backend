import { ForbiddenException } from '@nestjs/common';

export function assertTenantId(tenantId: string | null): asserts tenantId is string {
  if (!tenantId) {
    throw new ForbiddenException(
      'Se requiere una organización activa (Clerk org).',
    );
  }
}
