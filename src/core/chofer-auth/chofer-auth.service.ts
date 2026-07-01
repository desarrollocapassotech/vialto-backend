import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { verifyPin } from '../../shared/util/pin-hash';
import { ChoferLoginDto } from './dto/chofer-login.dto';

const TOKEN_EXPIRES_IN = '30d';

export interface ChoferTokenPayload {
  sub: string;
  tenantId: string;
  role: 'chofer';
}

@Injectable()
export class ChoferAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: ChoferLoginDto) {
    const chofer = await this.prisma.chofer.findFirst({
      where: { dni: dto.dni, pin: { not: null } },
    });
    if (!chofer || !chofer.pin || !verifyPin(dto.pin, chofer.pin)) {
      throw new UnauthorizedException('DNI o PIN incorrectos');
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
}
