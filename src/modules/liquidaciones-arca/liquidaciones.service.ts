import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CloudinaryService } from '../../shared/storage/cloudinary.service';
import { ArcaClientService } from './arca-client.service';
import { ArcaConfigService } from './arca-config.service';
import { ArcaException, ARCA_ERROR_CODES } from './types/arca.types';
import { computeAfipGravadoIva, round2 } from './arca-iva.util';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { UpdateLiquidacionDto } from './dto/update-liquidacion.dto';
import { syncViajeEstadoTrasComprobante } from '../viajes/viaje-estado-financiero';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';
import { getCbteTipoCvlp, parseNumeroFactura } from './arca.util';

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
    const transportista = await (this.prisma as PrismaAny).transportista.findFirst({
      where: { id: dto.transportistaId, tenantId },
      select: { id: true, condicionIva: true, comisionPct: true },
    });
    if (!transportista) {
      throw new NotFoundException('Transportista no encontrado');
    }

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

    // Verificar que ningún viaje ya tenga liquidación activa para este transportista
    await this.assertViajesSinLiquidacionActiva(tenantId, dto.transportistaId, viajes);

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
    // Los gastos extra del viaje (otrosGastos) no participan del cálculo del comprobante.
    const ivaPct = dto.ivaPct ?? config?.ivaGastosAdmin ?? 21;
    const montos = computeAfipGravadoIva(bruto, comision, ivaPct);
    const gastosAdmin = 0;
    const gastosAdminIva = montos.impIva;
    const liquido = montos.liquido;

    let liquidacion;
    try {
      liquidacion = await this.prisma.liquidacion.create({
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
          cbteTipo: getCbteTipoCvlp(transportista.condicionIva),
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          'La acción no es válida. Ya existe una liquidación previa para este transportista en uno de los viajes seleccionados.',
        );
      }
      throw e;
    }

    for (const viajeId of dto.viajeIds) {
      await syncViajeEstadoTrasComprobante(this.db, tenantId, viajeId);
    }

    return liquidacion;
  }

  async updateLiquidacion(
    tenantId: string,
    id: string,
    dto: UpdateLiquidacionDto,
  ) {
    const liq = await this.prisma.liquidacion.findUnique({ where: { id } });
    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }

    const wantsDatos =
      dto.periodoDesde !== undefined ||
      dto.periodoHasta !== undefined ||
      dto.comisionPct !== undefined ||
      dto.ivaPct !== undefined;

    const estadosEditables = new Set(['borrador', 'error', 'pendiente_cae']);
    if (wantsDatos && !estadosEditables.has(liq.estado)) {
      throw new BadRequestException(
        'Solo se pueden modificar período/comisión en liquidaciones en borrador, error o pendiente de CAE.',
      );
    }

    if (
      dto.periodoDesde !== undefined &&
      dto.periodoHasta !== undefined &&
      new Date(dto.periodoHasta) < new Date(dto.periodoDesde)
    ) {
      throw new BadRequestException(
        'La fecha hasta debe ser posterior o igual a la fecha desde.',
      );
    }

    const data: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.periodoDesde !== undefined) {
      data.periodoDesde = new Date(dto.periodoDesde);
    }
    if (dto.periodoHasta !== undefined) {
      data.periodoHasta = new Date(dto.periodoHasta);
    }
    if (dto.comprobanteUrl !== undefined) {
      data.comprobanteUrl = dto.comprobanteUrl || null;
    }

    if (dto.comisionPct !== undefined || dto.ivaPct !== undefined) {
      const comisionPct =
        dto.comisionPct !== undefined ? dto.comisionPct : liq.comisionPct;
      const bruto = liq.bruto as number;
      const comision = round2(bruto * comisionPct / 100);

      let ivaPct = dto.ivaPct;
      if (ivaPct === undefined) {
        const netoPrev = round2(bruto - (liq.comision as number));
        if (netoPrev > 0 && (liq.gastosAdminIva as number) > 0) {
          ivaPct = round2(((liq.gastosAdminIva as number) / netoPrev) * 100);
        } else {
          const config = await this.arcaConfig.findPublic(tenantId);
          ivaPct = config?.ivaGastosAdmin ?? 21;
        }
      }

      const montos = computeAfipGravadoIva(bruto, comision, ivaPct);
      data.comisionPct = comisionPct;
      data.comision = comision;
      data.gastosAdminIva = montos.impIva;
      data.liquido = montos.liquido;
    }

    await this.prisma.liquidacion.update({ where: { id }, data });
    return this.findById(tenantId, id);
  }

  /**
   * Emite la liquidación CVLP Tipo 60 a ARCA (AFIP) y obtiene el CAE.
   *
   * Solo se puede emitir desde `borrador` o `error`. El estado pasa a `pendiente_cae`
   * antes del request HTTP para evitar race conditions. Si AFIP no responde por
   * problemas de red, queda en `pendiente_cae` (HTTP 200). Si rechaza la solicitud,
   * pasa a `error` con el motivo guardado en `arcaError` (HTTP 422).
   */
  async emitirLiquidacion(tenantId: string, liquidacionId: string) {
    const liquidacion = await this.prisma.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: { 
        viajes: { include: { viaje: true } },
        transportista: { select: { idFiscal: true, condicionIva: true } }
      },
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

    // Re-evaluamos el cbteTipo dinámicamente para dar retrocompatibilidad a borradores
    // históricos que hayan quedado con el default(60) siendo monotributistas.
    // Lanza BadRequestException si falta el dato, logrando el fail-fast antes de tocar la BD.
    const cbteTipoFinal = getCbteTipoCvlp(liquidacion.transportista?.condicionIva);

    // Idempotencia: si el payload no cambió y hay un hash previo, no re-emitir
    const payloadHash = this.buildPayloadHash(liquidacion.id, liquidacion.liquido, config.ambiente);
    if (liquidacion.estado === 'pendiente_cae' && liquidacion.payloadHash === payloadHash) {
      throw new ConflictException(
        'La liquidación ya tiene una solicitud de CAE en curso. Esperar la respuesta o usar reintento.',
      );
    }

    // Marcar como pendiente antes de llamar a AFIP SDK
    const { count: lockCount } = await this.prisma.liquidacion.updateMany({
      where: {
        id: liquidacionId,
        tenantId,
        estado: { in: ['borrador', 'error'] },
      },
      data: {
        estado: 'pendiente_cae',
        payloadHash,
        reintentos: (liquidacion.reintentos ?? 0) + 1, // updateMany no soporta increment
        updatedAt: new Date(),
      },
    });

    if (lockCount === 0) {
      // El estado cambió concurrentemente; refrescamos desde BD para dar el mensaje preciso.
      const current = await this.findById(tenantId, liquidacionId);
      throw new ConflictException(
        `La liquidación no puede emitirse porque su estado actual es "${current.estado}". ` +
        'Solo se permite emitir desde "borrador" o "error".',
      );
    }

    try {
      // Obtener el próximo número de comprobante
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        config.ambiente as 'homologacion' | 'produccion',
        config.ptoVentaCvlp,
        cbteTipoFinal,
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
      );
      const cbteNro = ultimoCbte + 1;

      // Valida que el número local coincida con el esperado por AFIP (protege contra desfasajes).
      this.validarCorrelatividad(liquidacion.cbteNro, cbteNro, 'Liquidación');

      const fechaCbte = formatFechaCbte(new Date());
      const docNro = liquidacion.transportista?.idFiscal ? Number(liquidacion.transportista.idFiscal.replace(/-/g, '')) : 0;
      const docTipo = docNro ? DOC_TIPO_CUIT : DOC_TIPO_CF;
      const condicionIvaReceptorId = liquidacion.transportista?.condicionIva ?? 1;

      // impNeto = bruto - comisión; IVA sobre esa base (sin deducir gastos extra del viaje).
      const ivaPct = config?.ivaGastosAdmin ?? 21;
      const montos = computeAfipGravadoIva(liquidacion.bruto, liquidacion.comision, ivaPct);
      const response = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        {
          ambiente: config.ambiente as 'homologacion' | 'produccion',
          cuit: config.cuitEmisor,
          token: '',
          sign: '',
          ptoVenta: config.ptoVentaCvlp,
          cbteTipo: cbteTipoFinal,
          cbteNro,
          fechaCbte,
          concepto: 1,
          docTipo,
          docNro,
          condicionIvaReceptorId,
          impNeto: montos.impNeto,
          impIva: montos.impIva,
          impTotal: montos.liquido,
          alicuotasIva: [montos.alicuota],
        },
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
      );

      // AFIP autorizó: guardar CAE, fecha de vencimiento y pasar a autorizado.
      await this.prisma.liquidacion.updateMany({
        where: { id: liquidacionId, tenantId },
        data: {
          estado: 'autorizado',
          cbteTipo: cbteTipoFinal, // Actualizamos por si era un borrador viejo
          cbteNro,
          cae: response.CAE,
          caeFechaVto: parseAfipDate(response.CAEFchVto),
          arcaError: null,
          gastosAdmin: 0,
          gastosAdminIva: montos.impIva,
          liquido: montos.liquido,
          updatedAt: new Date(),
        },
      });

      return this.findById(tenantId, liquidacionId);
    } catch (err) {
      const isConectividad =
        err instanceof ArcaException && err.code === ARCA_ERROR_CODES.CONECTIVIDAD;
      const errMsg =
        err instanceof ArcaException
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      // Persistir el nuevo estado antes de responder al caller.
      // Conectividad (timeout/red) → pendiente_cae. Rechazo de AFIP → error.
      await this.prisma.liquidacion.updateMany({
        where: { id: liquidacionId, tenantId },
        data: {
          estado: isConectividad ? 'pendiente_cae' : 'error',
          arcaError: errMsg,
          updatedAt: new Date(),
        },
      });

      if (isConectividad) {
        // No lanzar excepción HTTP: el frontend recibe la entidad en pendiente_cae
        // y puede mostrar un banner informativo en lugar de un error bloqueante.
        this.logger.warn(`[emitirLiquidacion] ${liquidacionId} pendiente_cae por fallo de conectividad`);
        return this.findById(tenantId, liquidacionId);
      }

      this.logger.error(`Error al emitir liquidación ${liquidacionId}: ${errMsg}`);
      throw new UnprocessableEntityException(errMsg);
    }
  }

  async anularLiquidacion(tenantId: string, liquidacionId: string) {
    const liquidacion = await this.prisma.liquidacion.findUnique({
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
      liquidacion.cbteTipo,
      tenantId,
      liquidacionId,
      undefined,
      config.certPem,
      config.keyPem,
    );
    const cbteNro = ultimoCbte + 1;

    const docNro = transportista?.idFiscal ? Number(transportista.idFiscal.replace(/-/g, '')) : 0;
    const docTipo = docNro ? DOC_TIPO_CUIT : DOC_TIPO_CF;

    const ivaPct = config?.ivaGastosAdmin ?? 21;
    const montos = computeAfipGravadoIva(liquidacion.bruto, liquidacion.comision, ivaPct);
    await this.arcaClient.autorizarComprobante(
      config.apiKey,
      {
        ambiente: config.ambiente as 'homologacion' | 'produccion',
        cuit: config.cuitEmisor,
        token: '',
        sign: '',
        ptoVenta: config.ptoVentaCvlp,
        cbteTipo: liquidacion.cbteTipo,
        cbteNro,
        fechaCbte: formatFechaCbte(new Date()),
        concepto: 1,
        docTipo,
        docNro,
        condicionIvaReceptorId: transportista?.condicionIva ?? 1,
        impNeto: -montos.impNeto,
        impIva: -montos.impIva,
        impTotal: -montos.liquido,
        alicuotasIva: [
          {
            Id: montos.alicuota.Id,
            BaseImp: -montos.alicuota.BaseImp,
            Importe: -montos.alicuota.Importe,
          },
        ],
      },
      tenantId,
      liquidacionId,
      undefined,
      config.certPem,
      config.keyPem,
    );

    await this.prisma.liquidacion.update({
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
    const liq = await this.prisma.liquidacion.findUnique({
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
    await this.prisma.liquidacionViaje.deleteMany({ where: { liquidacionId: id } });
    await this.prisma.liquidacion.delete({ where: { id } });
    for (const viajeId of viajeIds) {
      await syncViajeEstadoTrasComprobante(this.db, tenantId, viajeId);
    }
  }

  async findAll(tenantId: string, estado?: string) {
    return this.prisma.liquidacion.findMany({
      where: { tenantId, ...(estado ? { estado } : {}) },
      include: {
        transportista: { select: { id: true, nombre: true, idFiscal: true } },
        viajes: { select: { viajeId: true, subtotal: true, tnDestino: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const liq = await this.prisma.liquidacion.findUnique({
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

      // Verificar que la numeración no tenga desfasaje
      if (facturaExt.cbteNro != null) {
        this.validarCorrelatividad(facturaExt.cbteNro, cbteNro, 'Factura');
      } else {
        const localCbteNro = parseNumeroFactura(factura.numero);
        if (isNaN(localCbteNro)) {
          throw new ArcaException(
            ARCA_ERROR_CODES.GENERICO,
            `El número de factura local "${factura.numero}" no es válido. Debe finalizar con el número correlativo del comprobante a autorizar (ej. "0001-00000045").`,
          );
        }
        this.validarCorrelatividad(localCbteNro, cbteNro, 'Factura');
      }

      // Calcular IVA 21% sobre el importe (ImpNeto = importe / 1.21 si ya es c/IVA,
      // o importe directamente si es neto). Aquí asumimos que factura.importe = neto.
      const montos = computeAfipGravadoIva(factura.importe, 0, 21);
      const impNeto = montos.impNeto;
      const impIva = montos.impIva;
      const impTotal = montos.liquido;

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
          alicuotasIva: [montos.alicuota],
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
          arcaError:
            err instanceof ArcaException
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err),
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

  private async assertViajesSinLiquidacionActiva(
    tenantId: string,
    transportistaId: string,
    viajes: Array<{ id: string; numero: string | null }>,
  ): Promise<void> {
    const viajeIds = viajes.map((v) => v.id);
    const existentes = await this.prisma.liquidacionViaje.findMany({
      where: {
        tenantId,
        viajeId: { in: viajeIds },
        liquidacion: {
          tenantId,
          transportistaId,
          estado: { not: 'anulado' },
        },
      },
      select: {
        viajeId: true,
        viaje: { select: { numero: true } },
      },
    });
    if (!existentes.length) return;

    const numeros = existentes
      .map((lv) => lv.viaje?.numero)
      .filter((n): n is string => Boolean(n?.trim()));
    if (numeros.length === 1) {
      throw new ConflictException(
        `La acción no es válida. Ya existe una liquidación previa para este transportista en el viaje #${numeros[0]}.`,
      );
    }
    if (numeros.length > 1) {
      throw new ConflictException(
        `La acción no es válida. Ya existen liquidaciones previas para este transportista en los viajes: ${numeros.map((n) => `#${n}`).join(', ')}.`,
      );
    }
    throw new ConflictException(
      'La acción no es válida. Ya existe una liquidación previa para este transportista en uno de los viajes seleccionados.',
    );
  }

  private validarCorrelatividad(
    localCbteNro: number | null | undefined,
    esperadoAfip: number,
    tipoComprobante: 'Liquidación' | 'Factura',
  ): void {
    if (localCbteNro != null && localCbteNro !== esperadoAfip) {
      throw new ArcaException(
        ARCA_ERROR_CODES.FUERA_DE_RANGO,
        `Desfasaje de numeración detectado. La ${tipoComprobante.toLowerCase()} local tiene asignado el número ${localCbteNro}, pero el próximo número correlativo esperado por AFIP es ${esperadoAfip}. Por favor, verifique y actualice la numeración antes de reintentar la emisión.`,
      );
    }
  }

  private buildPayloadHash(id: string, liquido: number, ambiente: string): string {
    return crypto
      .createHash('sha256')
      .update(`${id}|${liquido}|${ambiente}`)
      .digest('hex');
  }
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
