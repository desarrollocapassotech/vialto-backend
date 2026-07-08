import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { ArcaClientService } from './arca-client.service';
import { ArcaConfigService } from './arca-config.service';
import { ArcaException, ARCA_ERROR_CODES } from './types/arca.types';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { syncViajeEstadoTrasComprobante } from '../viajes/viaje-estado-financiero';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';

// IVA aliquot Id para 21%
const IVA_21_ID = 5;
// DocTipo AFIP: 80=CUIT, 99=Consumidor Final
const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CF = 99;

// Tipos para los nuevos modelos Prisma hasta que se ejecute `prisma generate`
// (los campos existen en schema.prisma; el cliente generado los tendrá sin cast)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

@Injectable()
export class LiquidacionesService {
  private readonly logger = new Logger(LiquidacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly arcaClient: ArcaClientService,
    private readonly arcaConfig: ArcaConfigService,
  ) {}

  /** Acceso a nuevos modelos Prisma pendientes de regenerar el cliente. */
  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  async uploadComprobante(tenantId: string, file: Express.Multer.File): Promise<{ url: string }> {
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
    if (!isPdf && !isImage) {
      throw new BadRequestException('El comprobante debe ser un PDF o una imagen.');
    }
    const url = await this.cloudinary.uploadComprobanteArchivo(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }

  // ── Liquidaciones (CVLP Tipo 60) ──────────────────────────────────────────

  async createLiquidacion(tenantId: string, userId: string, dto: CreateLiquidacionDto) {
    const config = await this.arcaConfig.findPublic(tenantId);

    // Obtener el transportista y su comisionPct
    const transportistaRaw = await this.prisma.transportista.findUnique({
      where: { id: dto.transportistaId },
    });
    if (!transportistaRaw || transportistaRaw.tenantId !== tenantId) {
      throw new NotFoundException('Transportista no encontrado');
    }
    // condicionIva y comisionPct son campos del schema pendientes de prisma generate
    const transportista = transportistaRaw as typeof transportistaRaw & {
      condicionIva: number | null;
      comisionPct: number | null;
    };

    // Determinar el % de comisión: dto > transportista > config default > 0
    const comisionPct = dto.comisionPct ?? transportista.comisionPct ?? config?.comisionPctDefault ?? 0;

    // Obtener los viajes y validar que pertenezcan al tenant y al transportista
    const viajes = await this.prisma.viaje.findMany({
      where: {
        id: { in: dto.viajeIds },
        tenantId,
        transportistaId: dto.transportistaId,
      },
    });

    if (viajes.length !== dto.viajeIds.length) {
      throw new BadRequestException(
        'Algunos viajes no existen, no pertenecen al tenant o no corresponden al transportista indicado',
      );
    }

    // Verificar que ningún viaje ya esté en otra liquidación
    const viajeIds = viajes.map((v) => v.id);
    const liquidacionViajesExistentes = await this.db.liquidacionViaje.findMany({
      where: { viajeId: { in: viajeIds } },
      select: { viajeId: true },
    });
    const yaLiquidadosIds = new Set(liquidacionViajesExistentes.map((lv) => lv.viajeId));
    const yaLiquidados = viajes.filter((v) => yaLiquidadosIds.has(v.id));
    if (yaLiquidados.length > 0) {
      throw new ConflictException(
        `Los viajes ${yaLiquidados.map((v) => v.id).join(', ')} ya están en otra liquidación`,
      );
    }

    // Obtener metadata de cada viaje para calcular montos
    const viajesConMeta = await this.prisma.viaje.findMany({
      where: { id: { in: dto.viajeIds }, tenantId },
      // Solo campos que necesitamos; metadata se lee del model
    });

    // Calcular montos
    let bruto = 0;
    const viajesDetalle: Array<{
      viajeId: string;
      tnOrigen: number | null;
      tnDestino: number | null;
      tarifaTransportista: number | null;
      subtotal: number;
      gastosAdmin: number;
    }> = [];

    for (const v of viajesConMeta) {
      const meta = (v as { metadata?: Record<string, unknown> }).metadata as Record<string, unknown> | null ?? {};
      const tnDestino = (meta.tnDestino as number | null) ?? null;
      const tnOrigen = (meta.tnOrigen as number | null) ?? null;
      const tarifaTransportista = (meta.tarifaTransportista as number | null) ?? null;

      // Granel (NyM): tnDestino × tarifaTransportista. Viaje estándar: precioTransportistaExterno.
      const subtotal = tnDestino != null && tarifaTransportista != null
        ? round2(tnDestino * tarifaTransportista)
        : round2((v as { precioTransportistaExterno?: number | null }).precioTransportistaExterno ?? 0);

      bruto += subtotal;
      viajesDetalle.push({
        viajeId: v.id,
        tnOrigen,
        tnDestino,
        tarifaTransportista,
        subtotal,
        gastosAdmin: 0,
      });
    }

    bruto = round2(bruto);
    const comision = round2(bruto * comisionPct / 100);
    const gastosAdmin = 0;
    // Los gastos extra del viaje (otrosGastos) no participan del cálculo del comprobante.
    const netoGravado = round2(bruto - comision);
    const ivaPct = dto.ivaPct ?? config?.ivaGastosAdmin ?? 21;
    const gastosAdminIva = round2(netoGravado * ivaPct / 100);
    const liquido = round2(netoGravado + gastosAdminIva);

    const liquidacion = await this.db.liquidacion.create({
      data: {
        tenantId,
        transportistaId: dto.transportistaId,
        periodoDesde: new Date(dto.periodoDesde),
        periodoHasta: new Date(dto.periodoHasta),
        cantViajes: dto.viajeIds.length,
        bruto,
        comisionPct,
        comision,
        gastosAdmin,
        gastosAdminIva,
        liquido,
        estado: 'borrador',
        cbteTipo: 60,
        ptoVenta: config?.ptoVentaCvlp ?? 0,
        comprobanteUrl: dto.comprobanteUrl ?? null,
        createdBy: userId,
        updatedAt: new Date(),
        viajes: {
          create: viajesDetalle.map((d) => ({
            tenantId,
            viajeId: d.viajeId,
            tnOrigen: d.tnOrigen,
            tnDestino: d.tnDestino,
            tarifaTransportista: d.tarifaTransportista,
            subtotal: d.subtotal,
            gastosAdmin: d.gastosAdmin,
          })),
        },
      },
      include: { viajes: true },
    });

    for (const viajeId of dto.viajeIds) {
      await syncViajeEstadoTrasComprobante(this.db, tenantId, viajeId);
    }

    return liquidacion;
  }

  async emitirLiquidacion(tenantId: string, liquidacionId: string) {
    const liquidacion = await this.db.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: { viajes: { include: { viaje: true } } },
    });

    if (!liquidacion || liquidacion.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    if (liquidacion.estado === 'autorizado') {
      throw new ConflictException('La liquidación ya tiene CAE autorizado');
    }
    if (liquidacion.estado === 'anulado') {
      throw new BadRequestException('La liquidación está anulada');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);

    // Idempotencia: si el payload no cambió y hay un hash previo, no re-emitir
    const payloadHash = this.buildPayloadHash(liquidacion.id, liquidacion.liquido, config.ambiente);
    if (liquidacion.payloadHash === payloadHash && liquidacion.estado === 'pendiente_cae') {
      throw new ConflictException(
        'La liquidación ya tiene una solicitud de CAE en curso. Esperar la respuesta o usar reintento.',
      );
    }

    // Marcar como pendiente antes de llamar a AFIP SDK
    await this.db.liquidacion.update({
      where: { id: liquidacionId },
      data: { estado: 'pendiente_cae', payloadHash, reintentos: { increment: 1 }, updatedAt: new Date() },
    });

    try {
      const transportista = await (this.prisma as PrismaAny).transportista.findUnique({
        where: { id: liquidacion.transportistaId },
        select: { idFiscal: true, condicionIva: true },
      });

      // Obtener el próximo número de comprobante
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        config.ambiente as 'homologacion' | 'produccion',
        config.ptoVentaCvlp,
        60,
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
      );
      const cbteNro = ultimoCbte + 1;

      const fechaCbte = formatFechaCbte(new Date());
      const docNro = transportista?.idFiscal ? Number(transportista.idFiscal.replace(/-/g, '')) : 0;
      const docTipo = docNro ? DOC_TIPO_CUIT : DOC_TIPO_CF;
      const condicionIvaReceptorId = transportista?.condicionIva ?? 1;

      // impNeto = bruto - comisión; IVA sobre esa base (sin deducir gastos extra del viaje).
      const ivaPct = config?.ivaGastosAdmin ?? 21;
      const impNeto = round2(liquidacion.bruto - liquidacion.comision);
      const impIva = round2(impNeto * ivaPct / 100);
      const impTotal = round2(impNeto + impIva);
      const ivaBase = impNeto;
      const response = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        {
          ambiente: config.ambiente as 'homologacion' | 'produccion',
          cuit: config.cuitEmisor,
          token: '',
          sign: '',
          ptoVenta: config.ptoVentaCvlp,
          cbteTipo: 60,
          cbteNro,
          fechaCbte,
          concepto: 1,
          docTipo,
          docNro,
          condicionIvaReceptorId,
          impNeto,
          impIva,
          impTotal,
          alicuotasIva: [{ Id: IVA_21_ID, BaseImp: ivaBase, Importe: impIva }],
        },
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
      );

      await this.db.liquidacion.update({
        where: { id: liquidacionId },
        data: {
          estado: 'autorizado',
          cbteNro,
          cae: response.CAE,
          caeFechaVto: parseAfipDate(response.CAEFchVto),
          arcaError: null,
          gastosAdmin: 0,
          gastosAdminIva: impIva,
          liquido: impTotal,
          updatedAt: new Date(),
        },
      });

      return this.findById(tenantId, liquidacionId);
    } catch (err) {
      const isConectividad =
        err instanceof ArcaException && err.code === ARCA_ERROR_CODES.CONECTIVIDAD;
      const errMsg = err instanceof Error ? err.message : String(err);

      await this.db.liquidacion.update({
        where: { id: liquidacionId },
        data: {
          estado: isConectividad ? 'pendiente_cae' : 'error',
          arcaError: errMsg,
          updatedAt: new Date(),
        },
      });

      this.logger.error(`Error al emitir liquidación ${liquidacionId}: ${errMsg}`);
      throw new UnprocessableEntityException(errMsg);
    }
  }

  async anularLiquidacion(tenantId: string, liquidacionId: string) {
    const liquidacion = await this.db.liquidacion.findUnique({
      where: { id: liquidacionId },
    });
    if (!liquidacion || liquidacion.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    if (liquidacion.estado !== 'autorizado') {
      throw new BadRequestException('Solo se pueden anular liquidaciones con CAE autorizado');
    }
    if (!liquidacion.cbteNro) {
      throw new BadRequestException('La liquidación no tiene número de comprobante');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);
    const transportista = await (this.prisma as PrismaAny).transportista.findUnique({
      where: { id: liquidacion.transportistaId },
      select: { idFiscal: true, condicionIva: true },
    });

    // Obtener próximo número para el comprobante negativo
    const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
      config.apiKey,
      config.cuitEmisor,
      config.ambiente as 'homologacion' | 'produccion',
      config.ptoVentaCvlp,
      60,
      tenantId,
      liquidacionId,
      undefined,
      config.certPem,
      config.keyPem,
    );
    const cbteNro = ultimoCbte + 1;

    const docNro = transportista?.idFiscal ? Number(transportista.idFiscal.replace(/-/g, '')) : 0;
    const docTipo = docNro ? DOC_TIPO_CUIT : DOC_TIPO_CF;

    // Comprobante negativo — misma estructura que la emisión original pero negativa
    const anulIva = round2(liquidacion.gastosAdminIva);
    const anulIvaBase = round2(liquidacion.bruto - liquidacion.comision);
    const anulNeto = round2(liquidacion.bruto - liquidacion.comision - liquidacion.gastosAdmin);
    await this.arcaClient.autorizarComprobante(
      config.apiKey,
      {
        ambiente: config.ambiente as 'homologacion' | 'produccion',
        cuit: config.cuitEmisor,
        token: '',
        sign: '',
        ptoVenta: config.ptoVentaCvlp,
        cbteTipo: 60,
        cbteNro,
        fechaCbte: formatFechaCbte(new Date()),
        concepto: 1,
        docTipo,
        docNro,
        condicionIvaReceptorId: transportista?.condicionIva ?? 1,
        impNeto: -anulNeto,
        impIva: -anulIva,
        impTotal: -liquidacion.liquido,
        alicuotasIva: [{ Id: IVA_21_ID, BaseImp: -anulIvaBase, Importe: -anulIva }],
      },
      tenantId,
      liquidacionId,
      undefined,
      config.certPem,
      config.keyPem,
    );

    await this.db.liquidacion.update({
      where: { id: liquidacionId },
      data: { estado: 'anulado', updatedAt: new Date() },
    });

    return this.findById(tenantId, liquidacionId);
  }

  async getConfig(tenantId: string) {
    return this.arcaConfig.findPublic(tenantId);
  }

  async upsertConfig(tenantId: string, dto: import('./dto/upsert-arca-config.dto').UpsertArcaConfigDto) {
    return this.arcaConfig.upsert(tenantId, dto);
  }

  async deleteLiquidacion(tenantId: string, id: string) {
    const liq = await this.db.liquidacion.findUnique({
      where: { id },
      select: {
        tenantId: true,
        estado: true,
        viajes: { select: { viajeId: true } },
      },
    });
    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    if (liq.estado === 'autorizado' || liq.estado === 'anulado') {
      throw new BadRequestException(
        'No se puede eliminar una liquidación autorizada o anulada',
      );
    }
    const viajeIds = liq.viajes.map((v) => v.viajeId);
    await this.db.liquidacionViaje.deleteMany({ where: { liquidacionId: id } });
    await this.db.liquidacion.delete({ where: { id } });
    for (const viajeId of viajeIds) {
      await syncViajeEstadoTrasComprobante(this.db, tenantId, viajeId);
    }
  }

  async findAll(tenantId: string, estado?: string) {
    return this.db.liquidacion.findMany({
      where: { tenantId, ...(estado ? { estado } : {}) },
      include: {
        transportista: { select: { id: true, nombre: true, idFiscal: true } },
        viajes: { select: { viajeId: true, subtotal: true, tnDestino: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const liq = await this.db.liquidacion.findUnique({
      where: { id },
      include: {
        transportista: {
          select: { id: true, nombre: true, idFiscal: true, condicionIva: true, domicilio: true, pais: true },
        },
        viajes: {
          include: {
            viaje: {
              select: {
                id: true,
                numero: true,
                fechaCarga: true,
                fechaDescarga: true,
                origen: true,
                destino: true,
              },
            },
          },
        },
      },
    });
    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    return liq;
  }

  // ── Facturas A/B via ARCA ──────────────────────────────────────────────────

  async emitirFacturaArca(tenantId: string, facturaId: string, dto: EmitirFacturaArcaDto) {
    const facturaRaw = await this.prisma.factura.findUnique({
      where: { id: facturaId },
    });
    const clienteRaw = facturaRaw?.clienteId
      ? await (this.prisma as PrismaAny).cliente.findUnique({
          where: { id: facturaRaw.clienteId },
          select: { idFiscal: true, condicionIva: true },
        })
      : null;
    const factura = facturaRaw ? { ...facturaRaw, clienteDatos: clienteRaw } : null;

    if (!factura || factura.tenantId !== tenantId) {
      throw new NotFoundException('Factura no encontrada');
    }
    // arcaEstado es campo nuevo pendiente de prisma generate
    const facturaExt = factura as typeof factura & {
      arcaEstado?: string | null;
      cbteTipo?: number | null;
      cbteNro?: number | null;
      ptoVenta?: number | null;
      cae?: string | null;
      caeFechaVto?: Date | null;
      arcaError?: string | null;
      condicionIva?: number | null;
    };
    if (facturaExt.arcaEstado === 'autorizado') {
      throw new ConflictException('La factura ya tiene CAE autorizado');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);

    // Marcar como pendiente
    await (this.prisma as PrismaAny).factura.update({
      where: { id: facturaId },
      data: {
        cbteTipo: dto.cbteTipo,
        ptoVenta: config.ptoVentaFactura,
        arcaEstado: 'pendiente_cae',
        arcaError: null,
      },
    });

    try {
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        config.ambiente as 'homologacion' | 'produccion',
        config.ptoVentaFactura,
        dto.cbteTipo,
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
      );
      const cbteNro = ultimoCbte + 1;

      // Calcular IVA 21% sobre el importe (ImpNeto = importe / 1.21 si ya es c/IVA,
      // o importe directamente si es neto). Aquí asumimos que factura.importe = neto.
      const impNeto = round2(factura.importe);
      const impIva = round2(impNeto * 0.21);
      const impTotal = round2(impNeto + impIva);

      const docNro = factura.clienteDatos?.idFiscal
        ? Number(factura.clienteDatos.idFiscal.replace(/-/g, ''))
        : 0;
      const docTipo = docNro ? DOC_TIPO_CUIT : DOC_TIPO_CF;
      const condicionIvaReceptorId = factura.clienteDatos?.condicionIva ?? 5;

      const response = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        {
          ambiente: config.ambiente as 'homologacion' | 'produccion',
          cuit: config.cuitEmisor,
          token: '',
          sign: '',
          ptoVenta: config.ptoVentaFactura,
          cbteTipo: dto.cbteTipo,
          cbteNro,
          fechaCbte: formatFechaCbte(new Date(factura.fechaEmision)),
          concepto: 1,
          docTipo,
          docNro,
          condicionIvaReceptorId,
          impNeto,
          impIva,
          impTotal,
          alicuotasIva: [{ Id: IVA_21_ID, BaseImp: impNeto, Importe: impIva }],
        },
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
      );

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          cbteNro,
          cae: response.CAE,
          caeFechaVto: parseAfipDate(response.CAEFchVto),
          arcaEstado: 'autorizado',
          arcaError: null,
        },
      });

      return this.prisma.factura.findUnique({ where: { id: facturaId } });
    } catch (err) {
      const isConectividad =
        err instanceof ArcaException && err.code === ARCA_ERROR_CODES.CONECTIVIDAD;

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          arcaEstado: isConectividad ? 'pendiente_cae' : 'error',
          arcaError: err instanceof Error ? err.message : String(err),
        },
      });

      throw err;
    }
  }

  // ── Logs de auditoría ─────────────────────────────────────────────────────

  async findLogs(tenantId: string, liquidacionId?: string, facturaId?: string) {
    return this.db.arcaLog.findMany({
      where: {
        tenantId,
        ...(liquidacionId ? { liquidacionId } : {}),
        ...(facturaId ? { facturaId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  private buildPayloadHash(id: string, liquido: number, ambiente: string): string {
    return crypto
      .createHash('sha256')
      .update(`${id}|${liquido}|${ambiente}`)
      .digest('hex');
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatFechaCbte(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function parseAfipDate(yyyymmdd: string): Date {
  return new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
  );
}
