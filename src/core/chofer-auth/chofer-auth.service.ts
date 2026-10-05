import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { verifyPin } from '../../shared/util/pin-hash';
import { ChoferLoginDto } from './dto/chofer-login.dto';
import { registrarErrorChofer } from './chofer-error-log';

const TOKEN_EXPIRES_IN = '30d';

export interface ChoferTokenPayload {
  sub: string;
  tenantId: string;
  role: 'chofer';
}

@Injectable()
export class ChoferAuthService {
  private readonly logger = new Logger(ChoferAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async login(dto: ChoferLoginDto) {
    const chofer = await this.prisma.chofer.findFirst({
      where: { dni: dto.dni, pin: { not: null } },
    });
    if (!chofer || !chofer.pin || !verifyPin(dto.pin, chofer.pin)) {
      await this.registrarLoginFallido(dto.dni, chofer ? 'PIN incorrecto' : null);
      throw new UnauthorizedException('DNI o PIN incorrectos');
    }
    if (!chofer.activo) {
      await registrarErrorChofer(this.prisma, {
        tenantId: chofer.tenantId,
        choferId: chofer.id,
        origen: 'login',
        mensaje: 'Login de chofer desactivado',
        payload: { dni: dto.dni },
      });
      throw new UnauthorizedException(
        'Tu usuario fue desactivado. Contactá a tu empresa.',
      );
    }

    const secret = process.env.CHOFER_JWT_SECRET;
    if (!secret) {
      throw new Error('CHOFER_JWT_SECRET no configurado');
    }
    const payload: ChoferTokenPayload = {
      sub: chofer.id,
      tenantId: chofer.tenantId,
      role: 'chofer',
    };
    const token = jwt.sign(payload, secret, { expiresIn: TOKEN_EXPIRES_IN });

    return {
      token,
      chofer: {
        id: chofer.id,
        nombre: chofer.nombre,
        dni: chofer.dni,
        tenantId: chofer.tenantId,
      },
    };
  }

  /**
   * Login rechazado: se registra contra cada chofer con ese DNI (puede haber uno por
   * tenant). Si el DNI no existe en ningún tenant no hay a quién atribuirlo — queda solo
   * en el log del servidor. Nunca se guarda el PIN tipeado.
   */
  private async registrarLoginFallido(dni: string, motivo: string | null) {
    const candidatos = await this.prisma.chofer.findMany({
      where: { dni },
      select: { id: true, tenantId: true, pin: true },
    });
    if (candidatos.length === 0) {
      this.logger.warn(`Login de chofer con DNI inexistente: ${dni}`);
      return;
    }
    for (const c of candidatos) {
      await registrarErrorChofer(this.prisma, {
        tenantId: c.tenantId,
        choferId: c.id,
        origen: 'login',
        mensaje: c.pin ? (motivo ?? 'PIN incorrecto') : 'El chofer no tiene PIN configurado',
        payload: { dni },
      });
    }
  }
}
