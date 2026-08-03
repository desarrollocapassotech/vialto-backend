import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';
import { encryptField, decryptField, validateKeyConfigured } from '../../shared/util/arca-crypto';
import { CUIT_TEST_HOMOLOGACION, normalizeArcaAmbiente } from './arca.util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

const CONFIG_SELECT = {
  cuitEmisor: true,
  razonSocial: true,
  domicilioEmisor: true,
  condicionIvaEmisor: true,
  ingBrutos: true,
  inicActEmisor: true,
  logoUrl: true,
  ptoVentaCvlp: true,
  ptoVentaFactura: true,
  ambiente: true,
  comisionPctDefault: true,
  ivaGastosAdmin: true,
  anulacionTipoComprobante: true,
  updatedAt: true,
  // cert/key se incluyen solo para saber si están configurados; el contenido no se expone
  certPemProduccion: true,
  keyPemProduccion: true,
};

export type UpsertArcaConfigOptions = {
  /** Solo el superadmin de plataforma puede cambiar el ambiente ARCA. */
  allowAmbienteChange?: boolean;
};

@Injectable()
export class ArcaConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {
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

  async upsert(
    tenantId: string,
    dto: UpsertArcaConfigDto,
    opts: UpsertArcaConfigOptions = {},
  ) {
    const allowAmbienteChange = opts.allowAmbienteChange === true;
    const existing = await this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: { ambiente: true },
    });

    const requestedAmbiente = normalizeArcaAmbiente(dto.ambiente);
    let ambiente: 'homologacion' | 'produccion';

    if (allowAmbienteChange) {
      ambiente = requestedAmbiente;
    } else if (existing) {
      ambiente = normalizeArcaAmbiente(existing.ambiente);
      if (requestedAmbiente !== ambiente) {
        throw new ForbiddenException(
          'Solo el superadmin de plataforma puede cambiar el ambiente de ARCA.',
        );
      }
    } else {
      // Primera configuración por admin de tenant: siempre homologación.
      ambiente = 'homologacion';
    }

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
      ambiente,
      comisionPctDefault: dto.comisionPctDefault,
      ivaGastosAdmin: dto.ivaGastosAdmin,
      anulacionTipoComprobante: dto.anulacionTipoComprobante ?? 'nota_credito',
      updatedAt: now,
    };
    // Solo sobreescribir cert/key si se envían con contenido.
    if (dto.certPemProduccion?.trim()) {
      data.certPemProduccion = encryptField(dto.certPemProduccion.trim());
    }
    if (dto.keyPemProduccion?.trim()) {
      data.keyPemProduccion = encryptField(dto.keyPemProduccion.trim());
    }

    await this.db.arcaConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return this.findPublic(tenantId);
  }

  async uploadLogo(
    tenantId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ) {
    await this.assertConfigExists(tenantId, 'Guardá primero el CUIT del emisor en "Datos del emisor" antes de subir el logo.');
    const url = await this.cloudinary.uploadArcaLogo(tenantId, buffer, originalName, mimeType);
    await this.db.arcaConfig.update({
      where: { tenantId },
      data: { logoUrl: url, updatedAt: new Date() },
    });
    return this.findPublic(tenantId);
  }

  async removeLogo(tenantId: string) {
    await this.assertConfigExists(tenantId, 'No hay configuración de ARCA para este tenant.');
    await this.db.arcaConfig.update({
      where: { tenantId },
      data: { logoUrl: null, updatedAt: new Date() },
    });
    return this.findPublic(tenantId);
  }

  private async assertConfigExists(tenantId: string, message: string): Promise<void> {
    const exists = await this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!exists) {
      throw new NotFoundException(message);
    }
  }

  async findPublic(tenantId: string) {
    const config = await this.db.arcaConfig.findUnique({
      where: { tenantId },
      select: CONFIG_SELECT,
    });
    if (!config) return null;
    const { certPemProduccion, keyPemProduccion, ...rest } = config;
    return {
      ...rest,
      ambiente: normalizeArcaAmbiente(rest.ambiente),
      certConfiguradoProduccion: Boolean(certPemProduccion),
      keyConfiguradoProduccion: Boolean(keyPemProduccion),
    };
  }

  async findWithApiKey(tenantId: string) {
    const config = await this.db.arcaConfig.findUnique({ where: { tenantId } });
    if (!config) {
      throw new NotFoundException(
        'No hay configuración de ARCA para este tenant. Configurarla en el panel de superadmin.',
      );
    }
    const ambiente = normalizeArcaAmbiente(config.ambiente);
    // Homologación: se usa el CUIT de prueba estándar de AFIP SDK, sin certificado propio
    // (mismo mecanismo que scripts/test-*.js) — evita depender de que cada tenant registre
    // y mantenga su propio certificado de homologación ante AFIP.
    // Producción: CUIT real del tenant + su certificado de producción.
    const esHomologacion = ambiente !== 'produccion';
    const cuitEmisor = esHomologacion ? CUIT_TEST_HOMOLOGACION : config.cuitEmisor;
    const certPem = esHomologacion ? null : config.certPemProduccion;
    const keyPem = esHomologacion ? null : config.keyPemProduccion;
    return {
      ...config,
      ambiente,
      cuitEmisor,
      certPem,
      keyPem,
      apiKey: this.getApiKey(),
    };
  }

  async validateConfigExists(tenantId: string): Promise<void> {
    await this.assertConfigExists(
      tenantId,
      'El tenant no tiene configuración de ARCA. Completar la configuración antes de emitir.',
    );
  }

  async migrateExistingConfigs(): Promise<void> {
    const configs = await this.db.arcaConfig.findMany({
      select: {
        tenantId: true,
        certPemProduccion: true,
        keyPemProduccion: true,
      },
    });

    let migratedCount = 0;
    let failedCount = 0;

    const ENCRYPTED_GCM_PATTERN = /^[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;
    const isGcm = (text: string) => ENCRYPTED_GCM_PATTERN.test(text);
    const FIELDS = ['certPemProduccion', 'keyPemProduccion'] as const;

    for (const config of configs) {
      try {
        let needsUpdate = false;
        const data: PrismaAny = {};

        for (const field of FIELDS) {
          const value = config[field] as string | null;
          if (value && !isGcm(value)) {
            data[field] = encryptField(decryptField(value));
            needsUpdate = true;
          }
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
