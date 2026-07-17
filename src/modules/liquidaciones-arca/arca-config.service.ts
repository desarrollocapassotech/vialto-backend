import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';
import { encryptField, isEncrypted, decryptField, validateKeyConfigured } from '../../shared/util/arca-crypto';

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
  // cert/key se incluyen solo para saber si están configurados; el contenido no se expone
  certPem: true,
  keyPem: true,
};

@Injectable()
export class ArcaConfigService {
  constructor(private readonly prisma: PrismaService) {
    validateKeyConfigured();
  }

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
    const data: PrismaAny = {
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
    // Solo sobreescribir cert/key si se envían con contenido
    if (dto.certPem?.trim()) data.certPem = encryptField(dto.certPem.trim());
    if (dto.keyPem?.trim()) data.keyPem = encryptField(dto.keyPem.trim());

    await this.db.arcaConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return this.findPublic(tenantId);
  }

  async findPublic(tenantId: string) {
    const config = await this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: CONFIG_SELECT,
    });
    if (!config) return null;
    const { certPem, keyPem, ...rest } = config;
    return {
      ...rest,
      certConfigurado: Boolean(certPem),
      keyConfigurado: Boolean(keyPem),
    };
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

  async migrateExistingConfigs(): Promise<void> {
    const configs = await this.db.arcaConfig.findMany({
      select: { tenantId: true, certPem: true, keyPem: true },
    });
    
    let migratedCount = 0;
    let failedCount = 0;

    const ENCRYPTED_GCM_PATTERN = /^[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;
    const isGcm = (text: string) => ENCRYPTED_GCM_PATTERN.test(text);

    for (const config of configs) {
      try {
        let needsUpdate = false;
        const data: PrismaAny = {};
        
        if (config.certPem && !isGcm(config.certPem)) {
          const decrypted = decryptField(config.certPem);
          data.certPem = encryptField(decrypted);
          needsUpdate = true;
        }
        if (config.keyPem && !isGcm(config.keyPem)) {
          const decrypted = decryptField(config.keyPem);
          data.keyPem = encryptField(decrypted);
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          await this.db.arcaConfig.update({
            where: { tenantId: config.tenantId },
            data,
          });
          migratedCount++;
        }
      } catch (error) {
        failedCount++;
        console.error(
          `[ArcaConfigService] Error al migrar certificados del tenant ${config.tenantId}: ${error.message}`
        );
      }
    }
    
    if (migratedCount > 0) {
      console.log(
        `[ArcaConfigService] Migración a AES-256-GCM completada. Se cifraron/actualizaron ${migratedCount} configuraciones.`
      );
    }
    if (failedCount > 0) {
      console.warn(
        `[ArcaConfigService] La migración falló en ${failedCount} configuraciones. Ver logs superiores.`
      );
    }
  }
}
