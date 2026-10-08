import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ChoferTokenPayload } from './chofer-auth.service';
import { registrarErrorChofer } from './chofer-error-log';

export type ChoferAuthRequest = Request & { choferAuth: ChoferTokenPayload };

@Injectable()
export class ChoferAuthGuard implements CanActivate {
  private readonly logger = new Logger(ChoferAuthGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      headers: Record<string, string | undefined>;
      choferAuth: ChoferTokenPayload;
    }>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      this.logger.warn(`Request de chofer sin token: ${req.method} ${req.url}`);
      throw new UnauthorizedException('Token de chofer requerido');
    }
    const token = authHeader.slice(7);
    const secret = process.env.CHOFER_JWT_SECRET;
    if (!secret) throw new Error('CHOFER_JWT_SECRET no configurado');
    let payload: ChoferTokenPayload;
    try {
      payload = jwt.verify(token, secret) as ChoferTokenPayload;
    } catch (error) {
      // Token vencido: la firma es válida, así que la identidad es confiable y se
      // registra contra su tenant. Firma inválida: solo log de servidor (no se puede
      // confiar en el tenantId que trae).
      if (error instanceof jwt.TokenExpiredError) {
        const vencido = jwt.verify(token, secret, { ignoreExpiration: true }) as ChoferTokenPayload;
        await registrarErrorChofer(this.prisma, {
          tenantId: vencido.tenantId,
          choferId: vencido.sub,
          origen: 'sesion',
          mensaje: `Sesión vencida (${error.expiredAt.toISOString()})`,
          payload: { http: { metodo: req.method, ruta: req.url, status: 401 } },
        });
      } else {
        this.logger.warn(`Token de chofer inválido: ${req.method} ${req.url}`);
      }
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
      if (chofer) {
        await registrarErrorChofer(this.prisma, {
          tenantId: payload.tenantId,
          choferId: payload.sub,
          origen: 'sesion',
          mensaje: 'Chofer desactivado intentó usar la app',
          payload: { http: { metodo: req.method, ruta: req.url, status: 401 } },
        });
      }
      throw new UnauthorizedException(
        'Tu usuario fue desactivado. Contactá a tu empresa.',
      );
    }

    req.choferAuth = payload;
    return true;
  }
}
