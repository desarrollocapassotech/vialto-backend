import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ChoferTokenPayload } from './chofer-auth.service';

export type ChoferAuthRequest = Request & { choferAuth: ChoferTokenPayload };

@Injectable()
export class ChoferAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    let payload: ChoferTokenPayload;
    try {
      payload = jwt.verify(token, secret) as ChoferTokenPayload;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // El JWT dura 30 días: además de la firma, se valida en cada request que el
    // chofer siga activo, para que una desactivación tenga efecto inmediato
    // y no recién cuando el token expire.
    const chofer = await this.prisma.chofer.findFirst({
      where: { id: payload.sub, tenantId: payload.tenantId },
      select: { activo: true },
    });
    if (!chofer || !chofer.activo) {
      throw new UnauthorizedException(
        'Tu usuario fue desactivado. Contactá a tu empresa.',
      );
    }

    req.choferAuth = payload;
    return true;
  }
}
