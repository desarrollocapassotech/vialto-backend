import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { ChoferTokenPayload } from './chofer-auth.service';

export type ChoferAuthRequest = Request & { choferAuth: ChoferTokenPayload };

@Injectable()
export class ChoferAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { headers: Record<string, string | undefined>; choferAuth: ChoferTokenPayload }>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de chofer requerido');
    }
    const token = authHeader.slice(7);
    const secret = process.env.CHOFER_JWT_SECRET;
    if (!secret) throw new Error('CHOFER_JWT_SECRET no configurado');
    try {
      const payload = jwt.verify(token, secret) as ChoferTokenPayload;
      req.choferAuth = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
