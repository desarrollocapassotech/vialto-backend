import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

const CONFIG_SELECT = {
  cuitEmisor: true,
  razonSocial: true,
  domicilioEmisor: true,
  condicionIvaEmisor: true,
  ingBrutos: true,
  inicActEmisor: true,
  ptoVentaCvlp: true,
  ptoVentaFactura: true,
  ambiente: true,
  comisionPctDefault: true,
  comisionPctAlt: true,
  ivaGastosAdmin: true,
  updatedAt: true,
};

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
    const data = {
      cuitEmisor: dto.cuitEmisor,
      razonSocial: dto.razonSocial ?? null,
      domicilioEmisor: dto.domicilioEmisor ?? null,
      condicionIvaEmisor: dto.condicionIvaEmisor ?? null,
      ingBrutos: dto.ingBrutos ?? null,
      inicActEmisor: dto.inicActEmisor ?? null,
      ptoVentaCvlp: dto.ptoVentaCvlp,
      ptoVentaFactura: dto.ptoVentaFactura,
      ambiente: dto.ambiente,
      comisionPctDefault: dto.comisionPctDefault,
      comisionPctAlt: dto.comisionPctAlt,
      ivaGastosAdmin: dto.ivaGastosAdmin,
      updatedAt: now,
    };
    await this.db.arcaConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return this.findPublic(tenantId);
  }

  async findPublic(tenantId: string) {
    return this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: CONFIG_SELECT,
    });
  }

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
