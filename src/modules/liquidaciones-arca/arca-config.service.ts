import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { ArcaClientService } from './arca-client.service';
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
  leyendaFactura: true,
  colorFactura: true,
  colorLiquidacion: true,
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

/** Resultado del ajuste automático de puntos de venta al cambiar de ambiente. */
export type AjustePuntosVenta = { ok: boolean; mensaje: string };

/** Punto de venta con el que AFIP SDK emite en homologación (CUIT de prueba). */
const PTO_VENTA_HOMOLOGACION = 1;

@Injectable()
export class ArcaConfigService {
  private readonly logger = new Logger(ArcaConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly arcaClient: ArcaClientService,
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
      select: { ambiente: true, certPemProduccion: true, keyPemProduccion: true },
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
    // Solo si viene en el request: un cliente que no conoce el campo no la borra.
    if (dto.leyendaFactura !== undefined) {
      data.leyendaFactura = dto.leyendaFactura.trim() || null;
    }
    if (dto.colorFactura !== undefined) {
      data.colorFactura = dto.colorFactura.toLowerCase() || null;
    }
    if (dto.colorLiquidacion !== undefined) {
      data.colorLiquidacion = dto.colorLiquidacion.toLowerCase() || null;
    }
    // Solo sobreescribir cert/key si se envían con contenido.
    if (dto.certPemProduccion?.trim()) {
      data.certPemProduccion = encryptField(dto.certPemProduccion.trim());
    }
    if (dto.keyPemProduccion?.trim()) {
      data.keyPemProduccion = encryptField(dto.keyPemProduccion.trim());
    }

    // Al cambiar de ambiente, los puntos de venta se ajustan solos: el que sirve en
    // homologación no existe en producción y viceversa (caso real NyM, nov 2026:
    // quedó PV 1 de homologación en producción y AFIP rechazó con 11002).
    let ajustePuntosVenta: AjustePuntosVenta | null = null;
    const cambiaAmbiente = existing
      ? normalizeArcaAmbiente(existing.ambiente) !== ambiente
      : ambiente === 'produccion';
    if (cambiaAmbiente) {
      ajustePuntosVenta = await this.ajustarPuntosVenta(data, {
        certPem: data.certPemProduccion ?? existing?.certPemProduccion ?? null,
        keyPem: data.keyPemProduccion ?? existing?.keyPemProduccion ?? null,
      });
    }

    await this.db.arcaConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    const config = await this.findPublic(tenantId);
    return ajustePuntosVenta ? { ...config, ajustePuntosVenta } : config;
  }

  /**
   * Setea `data.ptoVentaFactura`/`ptoVentaCvlp` según el ambiente de `data`.
   * Homologación: PV 1 (el del CUIT de prueba). Producción: consulta a AFIP los
   * PV habilitados para Web Services con el certificado del tenant; si el PV
   * configurado está habilitado lo respeta, si no usa el primero habilitado.
   * Si la consulta falla, deja los valores enviados y avisa (no bloquea el cambio).
   */
  private async ajustarPuntosVenta(
    data: PrismaAny,
    cred: { certPem: string | null; keyPem: string | null },
  ): Promise<AjustePuntosVenta> {
    if (data.ambiente !== 'produccion') {
      data.ptoVentaFactura = PTO_VENTA_HOMOLOGACION;
      data.ptoVentaCvlp = PTO_VENTA_HOMOLOGACION;
      return {
        ok: true,
        mensaje: `Puntos de venta ajustados a homologación: ${PTO_VENTA_HOMOLOGACION}.`,
      };
    }

    let habilitados: number[];
    try {
      habilitados = await this.arcaClient.getPuntosVentaWs(
        this.getApiKey(),
        data.cuitEmisor,
        cred.certPem,
        cred.keyPem,
      );
    } catch (err) {
      const detalle = (err as { message?: string })?.message ?? String(err);
      this.logger.warn(`No se pudieron consultar los PV de producción: ${detalle}`);
      return {
        ok: false,
        mensaje: `No se pudieron consultar en AFIP los puntos de venta de producción (${detalle}). Revisalos a mano en "Puntos de venta".`,
      };
    }

    if (!habilitados.length) {
      return {
        ok: false,
        mensaje:
          'AFIP no informa ningún punto de venta habilitado para Web Services en este CUIT. Dalo de alta en AFIP y cargalo en "Puntos de venta".',
      };
    }

    const elegir = (actual: number) =>
      habilitados.includes(actual) ? actual : habilitados[0];
    data.ptoVentaFactura = elegir(data.ptoVentaFactura);
    data.ptoVentaCvlp = elegir(data.ptoVentaCvlp);
    return {
      ok: true,
      mensaje: `Puntos de venta de producción tomados de AFIP: Factura A/B ${data.ptoVentaFactura}, CVLP ${data.ptoVentaCvlp}.`,
    };
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

  /**
   * Configuración que se usa cuando el tenant todavía no cargó la suya. Sin
   * configuración el tenant está, en la práctica, en homologación (toda config
   * nueva arranca ahí — ver `upsert`), y en homologación AFIP SDK no usa el
   * CUIT ni el certificado del tenant: se puede emitir igual, con datos de
   * emisor de prueba. El PDF ya sale con la marca de agua de homologación.
   * Para producción sí hace falta cargar la configuración real.
   */
  private async configHomologacionPorDefecto(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { name: true },
    });
    return {
      tenantId,
      cuitEmisor: CUIT_TEST_HOMOLOGACION,
      razonSocial: tenant?.name?.trim() || 'Emisor de prueba',
      domicilioEmisor: 'Domicilio de prueba (homologación)',
      condicionIvaEmisor: '1', // IVA Responsable Inscripto
      ingBrutos: CUIT_TEST_HOMOLOGACION,
      inicActEmisor: '01/01/2020',
      logoUrl: null as string | null,
      leyendaFactura: null as string | null,
      colorFactura: null as string | null,
      colorLiquidacion: null as string | null,
      ptoVentaCvlp: 1,
      ptoVentaFactura: 1,
      ambiente: 'homologacion' as const,
      comisionPctDefault: 8,
      ivaGastosAdmin: 21,
      anulacionTipoComprobante: 'nota_credito',
      updatedAt: new Date(),
      certPemProduccion: null as string | null,
      keyPemProduccion: null as string | null,
    };
  }

  /**
   * Datos del emisor para dibujar un comprobante (PDF): la config real del
   * tenant o, si no tiene, la de homologación por defecto — la misma con la
   * que `findWithApiKey` emitió el comprobante. No usar para la API pública:
   * ahí `findPublic` sigue devolviendo null para que la UI avise que falta
   * configurar ARCA para emitir en producción.
   */
  async findParaComprobante(tenantId: string) {
    const config = await this.findPublic(tenantId);
    if (config) return config;
    const { certPemProduccion, keyPemProduccion, ...rest } =
      await this.configHomologacionPorDefecto(tenantId);
    return {
      ...rest,
      certConfiguradoProduccion: Boolean(certPemProduccion),
      keyConfiguradoProduccion: Boolean(keyPemProduccion),
    };
  }

  async findWithApiKey(tenantId: string) {
    const config =
      (await this.db.arcaConfig.findUnique({ where: { tenantId } })) ??
      (await this.configHomologacionPorDefecto(tenantId));
    const ambiente = normalizeArcaAmbiente(config.ambiente);
    // Homologación: se usa el CUIT de prueba estándar de AFIP SDK, sin certificado propio
    // (mismo mecanismo que scripts/test-*.js) — evita depender de que cada tenant registre
    // y mantenga su propio certificado de homologación ante AFIP.
    // Producción: CUIT real del tenant + su certificado de producción.
    const esHomologacion = ambiente !== 'produccion';
    const cuitEmisor = esHomologacion ? CUIT_TEST_HOMOLOGACION : config.cuitEmisor;
    const certPem = esHomologacion ? null : config.certPemProduccion;
    const keyPem = esHomologacion ? null : config.keyPemProduccion;
    // En homologación AFIP SDK usa el CUIT de prueba con PV 1 (scripts/test-*.js).
    const ptoVentaFactura = esHomologacion ? 1 : config.ptoVentaFactura;
    const ptoVentaCvlp = esHomologacion ? 1 : config.ptoVentaCvlp;
    return {
      ...config,
      ambiente,
      cuitEmisor,
      certPem,
      keyPem,
      ptoVentaFactura,
      ptoVentaCvlp,
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
