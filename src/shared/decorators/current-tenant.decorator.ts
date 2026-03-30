import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Clerk organizationId (= tenantId en PostgreSQL). */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    return ctx.switchToHttp().getRequest().auth?.tenantId ?? null;
  },
);
