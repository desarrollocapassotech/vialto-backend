import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

@Injectable()
export class ArcaConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  private getApiKey(): string {
    const key = process.env.AFIP_SDK_API_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'Falta la variable de entorno AFIP_SDK_API_KEY. Configurarla en el servidor.',
      );
    }
    return key;
  }

  async upsert(tenantId: string, dto: UpsertArcaConfigDto) {
    const now = new Date();
    await this.db.arcaConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        cuitEmisor: dto.cuitEmisor,
        ptoVentaCvlp: dto.ptoVentaCvlp,
        ptoVentaFactura: dto.ptoVentaFactura,
        ambiente: dto.ambiente,
        comisionPctDefault: dto.comisionPctDefault,
        comisionPctAlt: dto.comisionPctAlt,
        gastosAdminPorViaje: dto.gastosAdminPorViaje,
        ivaGastosAdmin: dto.ivaGastosAdmin,
        updatedAt: now,
      },
      update: {
        cuitEmisor: dto.cuitEmisor,
        ptoVentaCvlp: dto.ptoVentaCvlp,
        ptoVentaFactura: dto.ptoVentaFactura,
        ambiente: dto.ambiente,
        comisionPctDefault: dto.comisionPctDefault,
        comisionPctAlt: dto.comisionPctAlt,
        gastosAdminPorViaje: dto.gastosAdminPorViaje,
        ivaGastosAdmin: dto.ivaGastosAdmin,
        updatedAt: now,
      },
    });
    return this.findPublic(tenantId);
  }

  /** Config pública (para mostrar en el panel superadmin). */
  async findPublic(tenantId: string) {
    return this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: {
        cuitEmisor: true,
        ptoVentaCvlp: true,
        ptoVentaFactura: true,
        ambiente: true,
        comisionPctDefault: true,
        comisionPctAlt: true,
        gastosAdminPorViaje: true,
        ivaGastosAdmin: true,
        updatedAt: true,
      },
    });
  }

  /** Config interna con API key desde env (solo uso interno de servicios). */
  async findWithApiKey(tenantId: string) {
    const config = await this.db.arcaConfig.findUnique({ where: { tenantId } });
    if (!config) {
      throw new NotFoundException(
        'No hay configuración de ARCA para este tenant. Configurarla en el panel de superadmin.',
      );
    }
    return { ...config, apiKey: this.getApiKey() };
  }

  async validateConfigExists(tenantId: string): Promise<void> {
    const exists = await this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!exists) {
      throw new NotFoundException(
        'El tenant no tiene configuración de ARCA. Completar la configuración antes de emitir.',
      );
    }
  }
}
