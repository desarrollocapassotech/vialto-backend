import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthPayload } from './clerk-auth.guard';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPayload => {
    return ctx.switchToHttp().getRequest().auth;
  },
);
