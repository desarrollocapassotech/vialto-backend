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
import { attachAnuladoPorNombres } from '../../shared/util/anulado-por-nombre.util';
import { ArcaClientService } from './arca-client.service';
import { ArcaConfigService } from './arca-config.service';
import { ArcaException, ARCA_ERROR_CODES } from './types/arca.types';
import {
  computeAfipGravadoIva,
  isAfipIvaPct,
  AFIP_IVA_PCTS,
  round2,
} from './arca-iva.util';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { UpdateLiquidacionDto } from './dto/update-liquidacion.dto';
import {
  syncFacturacionEstadoViajes,
  syncLiquidacionEstadoViajes,
} from '../viajes/viaje-estado-financiero';
import { AnularLiquidacionDto } from './dto/anular-liquidacion.dto';
import { EmitirFacturaArcaDto } from './dto/emitir-factura-arca.dto';
import {
  getCbteTipoCvlp,
  getCbteTipoAnulacionCvlp,
  getCbteTipoAnulacionFactura,
  getCbteTipoFactura,
  parseNumeroFactura,
  resolveFechaCbteEmision,
  resolveReceptorAfip,
} from './arca.util';
import { buildComprobanteCvlp, mapCvlpToArcaRequest } from './arca-cvlp.util';
import {
  buildFacturaConceptosList,
  defaultFacturaLineas,
  type FacturaLineaInput,
} from './factura-conceptos.util';
import { numeroVisibleViaje } from '../viajes/viaje-numero-visible.util';
import { assertFacturaEmitDatosCompletos } from './factura-emit-validation.util';
import { resolveIvaPct } from './arca-iva.util';
import { FacturaPdfService } from './factura-pdf.service';
import {
  buildCvlpConceptosList,
  computeLiquidacionTotales,
  type ConceptoLineaInput,
} from './cvlp-conceptos.util';
import { ConceptosLiquidacionService } from './conceptos-liquidacion.service';
import type { LiquidacionConceptoLineaDto } from './dto/create-liquidacion.dto';
import { assertCvlpEmitDatosCompletos } from './cvlp-emit-validation.util';
import { ClerkVialtoRoleService } from '../../core/auth/clerk-vialto-role.service';
import { AnularFacturaDto } from './dto/anular-factura.dto';

// DocTipo AFIP: 80=CUIT, 99=Consumidor Final
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
    private readonly conceptosLiquidacion: ConceptosLiquidacionService,
    private readonly facturaPdf: FacturaPdfService,
    private readonly clerkUsers: ClerkVialtoRoleService,
  ) {}

  /** Acceso a nuevos modelos Prisma pendientes de regenerar el cliente. */
  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  /** Resuelve DTOs de líneas → snapshots listos para persistir / totales. */
  private async resolveConceptoLineas(
    tenantId: string,
    dtos: LiquidacionConceptoLineaDto[] | undefined,
  ): Promise<Array<ConceptoLineaInput & { conceptoLiquidacionId: string }>> {
    if (!dtos?.length) return [];
    const out: Array<ConceptoLineaInput & { conceptoLiquidacionId: string }> = [];
    let orden = 0;
    for (const dto of dtos) {
      const c = await this.conceptosLiquidacion.findActivoOrThrow(
        tenantId,
        dto.conceptoLiquidacionId,
      );
      out.push({
        conceptoLiquidacionId: c.id,
        nombreSnapshot: c.nombre,
        signo: c.signo,
        ivaPct: c.ivaPct,
        monto: round2(dto.monto),
        orden: orden++,
        modoAplicacion: dto.modoAplicacion ?? 'GENERAL',
        viajeId: dto.viajeId ?? null,
      });
    }
    return out;
  }

  private lineasFromStored(
    rows: Array<{
      nombreSnapshot: string;
      signo: string;
      ivaPct: number;
      monto: number;
      orden?: number;
      modoAplicacion?: string;
      viajeId?: string | null;
    }> | null | undefined,
  ): ConceptoLineaInput[] {
    return (rows ?? []).map((r) => ({
      nombreSnapshot: r.nombreSnapshot,
      signo: r.signo as 'favor' | 'contra',
      ivaPct: r.ivaPct,
      monto: r.monto,
      orden: r.orden,
      modoAplicacion: r.modoAplicacion,
      viajeId: r.viajeId,
    }));
  }

  /**
   * AFIP solo acepta alícuotas oficiales. Tasas libres (ej. 10%) se persisten
   * bien en borrador, pero al emitir hay que usar 0 / 2.5 / 5 / 10.5 / 21 / 27.
   */
  private assertAfipIvaRates(
    ivaPctDefault: number,
    lineas: ConceptoLineaInput[],
  ): void {
    const tasas = [
      ivaPctDefault,
      ...lineas.map((l) => l.ivaPct),
    ].filter((p) => Number.isFinite(p));
    const invalidas = [
      ...new Set(
        tasas
          .filter((p) => !isAfipIvaPct(p))
          .map((p) => Math.round(p * 10) / 10),
      ),
    ];
    if (invalidas.length === 0) return;
    throw new BadRequestException(
      `La alícuota IVA ${invalidas.join(', ')}% no es válida para AFIP. ` +
        `Usá una de: ${AFIP_IVA_PCTS.join(', ')}.`,
    );
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
      const tnDestino = v.cantidadTransportista ?? null;
      const tnOrigen = null;
      const tarifaTransportista = v.precioUnitarioTransportista ?? null;

      // Desglose: cantidadTransportista × precioUnitarioTransportista. Viaje estándar: precioTransportistaExterno.
      const subtotal = tnDestino != null && tarifaTransportista != null
        ? round2(tnDestino * tarifaTransportista)
        : round2(v.precioTransportistaExterno ?? 0);

      // precioTransportistaExterno es siempre neto (sin IVA) — el % de IVA del viaje
      // (precioTransportistaIvaIncluidoPct) es independiente del IVA que declara esta
      // Liquidación (config aparte, más abajo) y no se usa acá.
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
    // Los gastos del viaje viven en `otrosGastos` y no forman parte de la liquidación/CVLP.
    const gastosAdmin = 0;
    // Usar != null para respetar ivaPct === 0 (liquidar sin IVA).
    const ivaPct =
      dto.ivaPct != null && Number.isFinite(dto.ivaPct)
        ? dto.ivaPct
        : (config?.ivaGastosAdmin ?? 21);
    const lineasResueltas = await this.resolveConceptoLineas(tenantId, dto.conceptosLineas);
    const montos = computeLiquidacionTotales({
      bruto,
      comision,
      ivaPctDefault: ivaPct,
      lineas: lineasResueltas,
      viajes,
    });
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
          ivaPct,
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

      if (lineasResueltas.length > 0) {
        await this.db.liquidacionConceptoLinea.createMany({
          data: lineasResueltas.map((l) => ({
            tenantId,
            liquidacionId: liquidacion.id,
            conceptoLiquidacionId: l.conceptoLiquidacionId,
            nombreSnapshot: l.nombreSnapshot,
            signo: l.signo,
            ivaPct: l.ivaPct,
            monto: l.monto,
            orden: l.orden ?? 0,
            modoAplicacion: l.modoAplicacion ?? 'GENERAL',
            viajeId: l.viajeId ?? null,
          })),
        });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          'La acción no es válida. Ya existe una liquidación previa para este transportista en uno de los viajes seleccionados.',
        );
      }
      throw e;
    }

    await syncLiquidacionEstadoViajes(this.db, tenantId, dto.viajeIds);

    return this.findById(tenantId, liquidacion.id);
  }

  async updateLiquidacion(
    tenantId: string,
    id: string,
    dto: UpdateLiquidacionDto,
  ) {
    const liq = await this.prisma.liquidacion.findUnique({
      where: { id },
      include: {
        viajes: { select: { viajeId: true, viaje: { select: { numero: true } } } },
      },
    });
    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }

    const wantsDatos =
      dto.periodoDesde !== undefined ||
      dto.periodoHasta !== undefined ||
      dto.comisionPct !== undefined ||
      dto.ivaPct !== undefined ||
      dto.conceptosLineas !== undefined;

    const estadosEditables = new Set(['borrador', 'error', 'pendiente_cae']);
    if (wantsDatos && !estadosEditables.has(liq.estado)) {
      throw new BadRequestException(
        'Solo se pueden modificar período/comisión/IVA/conceptos en liquidaciones en borrador, error o pendiente de CAE.',
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

    const needsRecalc =
      dto.comisionPct !== undefined ||
      dto.ivaPct !== undefined ||
      dto.conceptosLineas !== undefined;

    if (needsRecalc) {
      const comisionPct =
        dto.comisionPct !== undefined ? dto.comisionPct : liq.comisionPct;
      const bruto = liq.bruto as number;
      const comision = round2(bruto * comisionPct / 100);

      let ivaPct = dto.ivaPct;
      if (ivaPct === undefined) {
        // Conservar el snapshot de la liquidación; solo cae a config si es legado sin ivaPct.
        const stored = (liq as { ivaPct?: number | null }).ivaPct;
        if (stored != null) {
          ivaPct = stored;
        } else {
          const config = await this.arcaConfig.findPublic(tenantId);
          ivaPct = config?.ivaGastosAdmin ?? 21;
        }
      }

      const lineasResueltas =
        dto.conceptosLineas !== undefined
          ? await this.resolveConceptoLineas(tenantId, dto.conceptosLineas)
          : this.lineasFromStored(
              await this.db.liquidacionConceptoLinea.findMany({
                where: { liquidacionId: id },
                orderBy: { orden: 'asc' },
              }),
            );

      // No incluir gastos administrativos en el cálculo (siempre 0).
      const montos = computeLiquidacionTotales({
        bruto,
        comision,
        ivaPctDefault: ivaPct,
        lineas: lineasResueltas,
        viajes: liq.viajes.map((v) => ({ id: v.viajeId, numero: v.viaje.numero ?? '' })),
      });
      data.comisionPct = comisionPct;
      data.comision = comision;
      data.ivaPct = ivaPct;
      data.gastosAdmin = 0;
      data.gastosAdminIva = montos.impIva;
      data.liquido = montos.liquido;

      if (dto.conceptosLineas !== undefined) {
        await this.db.liquidacionConceptoLinea.deleteMany({
          where: { liquidacionId: id },
        });
        if (lineasResueltas.length > 0) {
          await this.db.liquidacionConceptoLinea.createMany({
            data: lineasResueltas.map((l) => ({
              tenantId,
              liquidacionId: id,
              conceptoLiquidacionId:
                'conceptoLiquidacionId' in l
                  ? (l as { conceptoLiquidacionId: string }).conceptoLiquidacionId
                  : null,
              nombreSnapshot: l.nombreSnapshot,
              signo: l.signo,
              ivaPct: l.ivaPct,
              monto: l.monto,
              orden: l.orden ?? 0,
              modoAplicacion: l.modoAplicacion ?? 'GENERAL',
              viajeId: l.viajeId ?? null,
            })),
          });
        }
      }
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
  async emitirLiquidacion(
    tenantId: string,
    liquidacionId: string,
    ptoVenta?: number,
  ) {
    const liquidacion = await this.prisma.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: {
        viajes: {
          include: {
            viaje: {
              select: {
                id: true,
                numero: true,
                cliente: {
                  select: { nombre: true, idFiscal: true, direccion: true },
                },
              },
            },
          },
        },
        transportista: {
          select: { idFiscal: true, condicionIva: true, domicilio: true },
        },
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
    // Punto de venta editable por operación; si no se envía, se usa el de ArcaConfig.
    const ptoVentaFinal = ptoVenta ?? config.ptoVentaCvlp;

    // Fail-fast: PDF CVLP no debe emitirse con secciones vacías (emisor / transportista / cliente).
    assertCvlpEmitDatosCompletos({
      emisor: config,
      transportista: liquidacion.transportista,
      cliente: liquidacion.viajes?.[0]?.viaje?.cliente,
    });

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

    const viajeIdsLiquidacion = liquidacion.viajes.map((v) => v.viajeId);
    await syncLiquidacionEstadoViajes(this.db, tenantId, viajeIdsLiquidacion);

    try {

      // Obtener el próximo número de comprobante
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        config.ambiente as 'homologacion' | 'produccion',
        ptoVentaFinal,
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
      const docNroReal = liquidacion.transportista?.idFiscal
        ? Number(liquidacion.transportista.idFiscal.replace(/-/g, ''))
        : 0;
      const condicionIvaReceptorId = liquidacion.transportista?.condicionIva ?? 1;
      const receptor = resolveReceptorAfip({
        ambiente: config.ambiente as 'homologacion' | 'produccion',
        cbteTipo: cbteTipoFinal,
        docNroReal,
        condicionIvaReceptorId,
      });

      // impNeto/IVA/total: flete + comisión + conceptos configurables.
      // Preferir el snapshot de la liquidación para no pisar un override puntual.
      const ivaPct =
        (liquidacion as { ivaPct?: number | null }).ivaPct ??
        config?.ivaGastosAdmin ??
        21;
      const lineasDb = await this.db.liquidacionConceptoLinea.findMany({
        where: { liquidacionId },
        orderBy: { orden: 'asc' },
      });
      const lineas = this.lineasFromStored(lineasDb);
      this.assertAfipIvaRates(ivaPct, lineas);
      const conceptos = buildCvlpConceptosList({
        bruto: liquidacion.bruto,
        comision: liquidacion.comision,
        ivaPctDefault: ivaPct,
        lineas,
        viajes: liquidacion.viajes.map((v) => ({ id: v.viajeId, numero: v.viaje.numero ?? '' })),
      });
      // Autocuración: si se editaron conceptos y el líquido quedó desfasado, alinear antes de AFIP.
      const montos = computeLiquidacionTotales({
        bruto: liquidacion.bruto,
        comision: liquidacion.comision,
        ivaPctDefault: ivaPct,
        lineas,
        viajes: liquidacion.viajes.map((v) => ({ id: v.viajeId, numero: v.viaje.numero ?? '' })),
      });
      if (
        montos.liquido !== liquidacion.liquido ||
        montos.impIva !== liquidacion.gastosAdminIva
      ) {
        await this.prisma.liquidacion.updateMany({
          where: { id: liquidacionId, tenantId },
          data: {
            gastosAdminIva: montos.impIva,
            liquido: montos.liquido,
            updatedAt: new Date(),
          },
        });
      }
      const cabeceraBase = {
        cuit: config.cuitEmisor,
        ptoVenta: ptoVentaFinal,
        cbteTipo: cbteTipoFinal,
        cbteNro,
        fechaCbte,
        concepto: 1,
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      };

      const cvlp = buildComprobanteCvlp(cabeceraBase, conceptos, ivaPct);
      const arcaRequest = mapCvlpToArcaRequest(cvlp, config.ambiente as 'homologacion' | 'produccion');

      const response = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        arcaRequest,
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
        cvlp as unknown as Record<string, unknown>, // auditMetadata
      );

      // AFIP autorizó: guardar CAE, fecha de vencimiento y pasar a autorizado.
      await this.prisma.liquidacion.updateMany({
        where: { id: liquidacionId, tenantId },
        data: {
          estado: 'autorizado',
          cbteTipo: cbteTipoFinal, // Actualizamos por si era un borrador viejo
          cbteNro,
          ptoVenta: ptoVentaFinal,
          cae: response.CAE,
          caeFechaVto: parseAfipDate(response.CAEFchVto),
          ambiente: config.ambiente, // 'produccion' | 'homologacion' con el que se emitió
          arcaError: null,
          gastosAdmin: 0,
          gastosAdminIva: cvlp.impIva,
          liquido: cvlp.impTotal,
          updatedAt: new Date(),
        },
      });
      await syncLiquidacionEstadoViajes(this.db, tenantId, viajeIdsLiquidacion);

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
          arcaErrorDetalle:
            err instanceof ArcaException ? (err.detalle ?? null) : null,
          updatedAt: new Date(),
        } as PrismaAny,
      });
      await syncLiquidacionEstadoViajes(this.db, tenantId, viajeIdsLiquidacion);

      if (isConectividad) {
        // No lanzar excepción HTTP: el frontend recibe la entidad en pendiente_cae
        // y puede mostrar un banner informativo en lugar de un error bloqueante.
        this.logger.warn(`[emitirLiquidacion] ${liquidacionId} pendiente_cae por fallo de conectividad`);
        return this.findById(tenantId, liquidacionId);
      }

      this.logger.error(`Error al emitir liquidación ${liquidacionId}: ${errMsg}`);
      throw new UnprocessableEntityException({
        message: errMsg,
        detalle: err instanceof ArcaException ? err.detalle : undefined,
      });
    }
  }

  /**
   * Anula una liquidación autorizada emitiendo vía AFIP un comprobante estándar
   * (Nota de Crédito 3/8 o Nota de Débito 2/7, elegible por `tipoAnulacion`)
   * asociado al CVLP original (CbtesAsoc). Importes en positivo: AFIP rechaza el
   * 065 (no existe en WS) y los negativos. Tras éxito, estado → `anulado`;
   * el CVLP original (CAE/PDF) se conserva. Requiere `motivo` y libera viajes.
   */
  async anularLiquidacion(
    tenantId: string,
    liquidacionId: string,
    userId: string,
    dto: AnularLiquidacionDto,
  ) {
    const motivo = String(dto?.motivo ?? '').trim();
    if (!motivo) {
      throw new BadRequestException('El motivo de anulación es obligatorio.');
    }
    const tipoAnulacion = dto?.tipoAnulacion;

    const liquidacion = await this.prisma.liquidacion.findUnique({
      where: { id: liquidacionId },
      include: { viajes: { select: { viajeId: true, viaje: { select: { numero: true } } } } },
    });
    if (!liquidacion || liquidacion.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    if (liquidacion.estado !== 'autorizado') {
      throw new BadRequestException('Solo se pueden anular liquidaciones con CAE autorizado');
    }
    if (!liquidacion.cbteNro || !liquidacion.ptoVenta) {
      throw new BadRequestException('La liquidación no tiene número de comprobante');
    }
    if ((liquidacion as { anulacionCae?: string | null }).anulacionCae) {
      throw new BadRequestException('Esta liquidación ya tiene un comprobante de anulación.');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);
    const transportista = await (this.prisma as PrismaAny).transportista.findUnique({
      where: { id: liquidacion.transportistaId },
      select: { idFiscal: true, condicionIva: true },
    });

    // AFIP no habilita la NC 065 ni importes negativos por web service. El CVLP se
    // anula con una Nota de Crédito estándar (tipo 3 clase A / 8 clase B) asociada
    // al 060/061 original mediante CbtesAsoc. Verificado contra AFIP (devuelve CAE).
    const cbteTipoAnulacion = getCbteTipoAnulacionCvlp(
      transportista?.condicionIva,
      tipoAnulacion ??
        (config as { anulacionTipoComprobante?: 'nota_credito' | 'nota_debito' })
          .anulacionTipoComprobante,
    );
    const viajeIds = liquidacion.viajes.map((v) => v.viajeId);

    try {
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        config.ambiente as 'homologacion' | 'produccion',
        config.ptoVentaCvlp,
        cbteTipoAnulacion,
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
      );
      const cbteNro = ultimoCbte + 1;

      const docNroReal = transportista?.idFiscal
        ? Number(transportista.idFiscal.replace(/-/g, ''))
        : 0;
      const condicionIvaReceptorId = transportista?.condicionIva ?? 1;
      const receptor = resolveReceptorAfip({
        ambiente: config.ambiente as 'homologacion' | 'produccion',
        cbteTipo: cbteTipoAnulacion,
        docNroReal,
        condicionIvaReceptorId,
      });
      const ivaPct =
        (liquidacion as { ivaPct?: number | null }).ivaPct ??
        config?.ivaGastosAdmin ??
        21;

      // Importes en positivo: la Nota de Crédito acredita por su tipo, no por signo.
      const lineasDb = await this.db.liquidacionConceptoLinea.findMany({
        where: { liquidacionId },
        orderBy: { orden: 'asc' },
      });
      const conceptos = buildCvlpConceptosList({
        bruto: Number(liquidacion.bruto || 0),
        comision: Number(liquidacion.comision || 0),
        ivaPctDefault: ivaPct,
        lineas: this.lineasFromStored(lineasDb),
        viajes: liquidacion.viajes.map((v) => ({ id: v.viajeId, numero: v.viaje.numero ?? '' })),
      });

      const fechaNc = formatFechaCbte(new Date());
      const fechaCvlpAsoc = await this.resolveFechaCbteOriginal(liquidacionId, liquidacion);

      const cabeceraBase = {
        cuit: config.cuitEmisor,
        ptoVenta: config.ptoVentaCvlp,
        cbteTipo: cbteTipoAnulacion,
        cbteNro,
        fechaCbte: fechaNc,
        concepto: 1,
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      };

      const cvlp = buildComprobanteCvlp(cabeceraBase, conceptos, ivaPct);
      const cbtesAsoc = [
        {
          Tipo: liquidacion.cbteTipo,
          PtoVta: liquidacion.ptoVenta,
          Nro: liquidacion.cbteNro,
          Cuit: String(config.cuitEmisor).replace(/[-\s]/g, ''),
          CbteFch: fechaCvlpAsoc,
        },
      ];
      const arcaRequest = mapCvlpToArcaRequest(
        cvlp,
        config.ambiente as 'homologacion' | 'produccion',
        cbtesAsoc,
      );

      const authResult = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        arcaRequest,
        tenantId,
        liquidacionId,
        undefined,
        config.certPem,
        config.keyPem,
        {
          ...(cvlp as unknown as Record<string, unknown>),
          cbtesAsoc,
          anulacionDe: {
            cbteTipo: liquidacion.cbteTipo,
            cbteNro: liquidacion.cbteNro,
            ptoVenta: liquidacion.ptoVenta,
            cae: liquidacion.cae,
          },
        },
      );

      const caeFechaVto = parseAfipDate(authResult.CAEFchVto);
      const anuladoAt = new Date();
      const anuladoPorLabel =
        (await this.clerkUsers.getUserDisplayLabel(userId))?.trim() || userId;

      // El CVLP original se conserva (CAE / número / PDF siguen disponibles).
      await this.prisma.liquidacion.update({
        where: { id: liquidacionId },
        data: {
          estado: 'anulado',
          anulacionCbteTipo: cbteTipoAnulacion,
          anulacionCbteNro: cbteNro,
          anulacionPtoVenta: config.ptoVentaCvlp,
          anulacionCae: authResult.CAE,
          anulacionCaeFechaVto: caeFechaVto,
          anulacionFecha: anuladoAt,
          motivoAnulacion: motivo,
          anuladoPor: userId,
          anuladoAt,
          updatedAt: anuladoAt,
        } as PrismaAny,
      });

      // Los vínculos LiquidacionViaje se conservan (auditoría); al estar anulada,
      // el sync recalcula liquidacionEstado = 'anulado' y libera el viaje para re-liquidar.
      await syncLiquidacionEstadoViajes(this.db, tenantId, viajeIds);

      const updated = await this.findById(tenantId, liquidacionId);
      // Asegura nombre en la respuesta inmediata (findById también lo resuelve).
      return { ...updated, anuladoPorNombre: anuladoPorLabel };
    } catch (err) {
      const errMsg =
        err instanceof ArcaException
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(`Error al anular liquidación ${liquidacionId}: ${errMsg}`);
      throw new UnprocessableEntityException({
        message: errMsg,
        detalle: err instanceof ArcaException ? err.detalle : undefined,
      });
    }
  }

  /**
   * Anula una Factura A/B autorizada emitiendo Nota de Crédito A (03) o B (08)
   * asociada al comprobante original (CbtesAsoc), reutilizando el cliente AFIP
   * del tenant. Persiste CAE de la NC, marca arcaEstado=anulado y sube el PDF.
   */
  async anularFacturaArca(
    tenantId: string,
    facturaId: string,
    userId: string,
    dto: AnularFacturaDto,
  ) {
    const motivo = String(dto?.motivo ?? '').trim();
    if (!motivo) {
      throw new BadRequestException('El motivo de anulación es obligatorio.');
    }

    const facturaRaw = await this.prisma.factura.findUnique({
      where: { id: facturaId },
      include: {
        viajes: {
          select: {
            id: true,
            numero: true,
            numeroIdentificacionPersonalizado: true,
            monto: true,
            cantidadFactura: true,
            precioUnitarioFactura: true,
            origen: true,
            destino: true,
          },
        },
        cliente: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            direccion: true,
            condicionIva: true,
          },
        },
      },
    });

    if (!facturaRaw || facturaRaw.tenantId !== tenantId) {
      throw new NotFoundException('Factura no encontrada');
    }

    const factura = facturaRaw as typeof facturaRaw & {
      arcaEstado?: string | null;
      cbteTipo?: number | null;
      cbteNro?: number | null;
      ptoVenta?: number | null;
      cae?: string | null;
      caeFechaVto?: Date | null;
      anulacionCae?: string | null;
      arcaError?: string | null;
      ivaPct?: number | null;
    };

    if (factura.arcaEstado === 'anulado' || factura.anulacionCae) {
      throw new BadRequestException(
        'Esta factura ya tiene un comprobante de anulación.',
      );
    }
    // Factura original con CAE: permite reintento si un intento previo quedó
    // en pendiente_cae / error (conectividad o rechazo AFIP de la NC).
    if (!factura.cae) {
      throw new BadRequestException(
        'Solo se pueden anular facturas con CAE autorizado.',
      );
    }
    if (
      factura.arcaEstado !== 'autorizado' &&
      factura.arcaEstado !== 'pendiente_cae' &&
      factura.arcaEstado !== 'error'
    ) {
      throw new BadRequestException(
        'Solo se pueden anular facturas con CAE autorizado.',
      );
    }
    if (!factura.cbteNro || !factura.ptoVenta || !factura.cbteTipo) {
      throw new BadRequestException(
        'La factura no tiene número de comprobante AFIP completo.',
      );
    }
    if (factura.cbteTipo !== 1 && factura.cbteTipo !== 6) {
      throw new BadRequestException(
        'Solo se pueden anular Facturas A (01) o B (06).',
      );
    }
    if (facturaRaw.tipo !== 'cliente') {
      throw new BadRequestException(
        'Solo se pueden anular facturas de tipo cliente por ARCA.',
      );
    }
    if (!facturaRaw.cliente) {
      throw new BadRequestException('La factura no tiene un cliente asociado.');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);
    const ambiente = config.ambiente as 'homologacion' | 'produccion';
    const cbteTipoNc = getCbteTipoAnulacionFactura(
      factura.cbteTipo,
      facturaRaw.cliente.condicionIva,
    );
    const ivaPctDefault = resolveIvaPct(
      factura.ivaPct ?? config.ivaGastosAdmin,
    );
    const lineasInput: FacturaLineaInput[] = defaultFacturaLineas(
      facturaRaw,
      facturaRaw.viajes,
    );
    if (lineasInput.length === 0 || lineasInput.every((l) => l.importe === 0)) {
      throw new BadRequestException(
        'La factura no tiene líneas con importe para anular.',
      );
    }
    const conceptos = buildFacturaConceptosList(lineasInput, ivaPctDefault);

    await (this.prisma as PrismaAny).factura.update({
      where: { id: facturaId },
      data: { arcaEstado: 'pendiente_cae', arcaError: null },
    });

    try {
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        ambiente,
        config.ptoVentaFactura,
        cbteTipoNc,
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
      );
      const cbteNro = ultimoCbte + 1;

      const docNroReal = facturaRaw.cliente.idFiscal
        ? Number(facturaRaw.cliente.idFiscal.replace(/-/g, ''))
        : 0;
      const condicionIvaReceptorId = facturaRaw.cliente.condicionIva ?? 5;
      const receptor = resolveReceptorAfip({
        ambiente,
        cbteTipo: cbteTipoNc,
        docNroReal,
        condicionIvaReceptorId,
      });

      const fechaNc = formatFechaCbte(new Date());
      const fechaFacturaAsoc = await this.resolveFechaCbteFacturaOriginal(
        facturaId,
        facturaRaw.fechaEmision,
      );

      const cabeceraBase = {
        cuit: config.cuitEmisor,
        ptoVenta: config.ptoVentaFactura,
        cbteTipo: cbteTipoNc,
        cbteNro,
        fechaCbte: fechaNc,
        concepto: 1,
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      };
      const comprobante = buildComprobanteCvlp(
        cabeceraBase,
        conceptos,
        ivaPctDefault,
      );
      const cbtesAsoc = [
        {
          Tipo: factura.cbteTipo,
          PtoVta: factura.ptoVenta,
          Nro: factura.cbteNro,
          Cuit: String(config.cuitEmisor).replace(/[-\s]/g, ''),
          CbteFch: fechaFacturaAsoc,
        },
      ];
      const arcaRequest = mapCvlpToArcaRequest(comprobante, ambiente, cbtesAsoc);

      const authResult = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        arcaRequest,
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
        {
          ...(comprobante as unknown as Record<string, unknown>),
          cbtesAsoc,
          anulacionDe: {
            cbteTipo: factura.cbteTipo,
            cbteNro: factura.cbteNro,
            ptoVenta: factura.ptoVenta,
            cae: factura.cae,
          },
        },
      );

      const caeFechaVto = parseAfipDate(authResult.CAEFchVto);
      const anuladoAt = new Date();

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          arcaEstado: 'anulado',
          arcaError: null,
          anulacionCbteTipo: cbteTipoNc,
          anulacionCbteNro: cbteNro,
          anulacionPtoVenta: config.ptoVentaFactura,
          anulacionCae: authResult.CAE,
          anulacionCaeFechaVto: caeFechaVto,
          anulacionFecha: anuladoAt,
          motivoAnulacion: motivo,
          anuladoPor: userId,
          anuladoAt,
        },
      });
      // Fix del bug histórico: sin este sync, `facturacionEstado` quedaba pisado
      // como "facturado" para siempre y el viaje nunca volvía a ser re-facturable.
      await syncFacturacionEstadoViajes(
        this.db,
        tenantId,
        facturaRaw.viajes.map((v) => v.id),
      );

      let notaCreditoUrl: string | null = null;
      try {
        const { buffer, filename } = await this.facturaPdf.generateNotaCredito(
          tenantId,
          facturaId,
        );
        if (this.cloudinary.isConfigured()) {
          notaCreditoUrl = await this.cloudinary.uploadComprobanteArchivo(
            tenantId,
            buffer,
            filename,
            'application/pdf',
          );
          await (this.prisma as PrismaAny).factura.update({
            where: { id: facturaId },
            data: { notaCreditoUrl },
          });
        } else {
          this.logger.warn(
            `[anularFacturaArca] Cloudinary no configurado; PDF NC no subido para ${facturaId}`,
          );
        }
      } catch (pdfErr) {
        this.logger.error(
          `[anularFacturaArca] Error generando/subiendo PDF NC para ${facturaId}: ${
            pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
          }`,
        );
      }

      return this.prisma.factura.findUnique({
        where: { id: facturaId },
        include: {
          viajes: { select: { id: true } },
          cliente: {
            select: {
              id: true,
              nombre: true,
              idFiscal: true,
              condicionIva: true,
            },
          },
        },
      });
    } catch (err) {
      const isConectividad =
        err instanceof ArcaException &&
        err.code === ARCA_ERROR_CODES.CONECTIVIDAD;
      const errMsg =
        err instanceof ArcaException
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          arcaEstado: isConectividad ? 'pendiente_cae' : 'error',
          arcaError: errMsg,
        },
      });
      await syncFacturacionEstadoViajes(
        this.db,
        tenantId,
        facturaRaw.viajes.map((v) => v.id),
      );

      if (isConectividad) {
        this.logger.warn(
          `[anularFacturaArca] ${facturaId} pendiente_cae por fallo de conectividad`,
        );
        return this.prisma.factura.findUnique({ where: { id: facturaId } });
      }

      this.logger.error(`Error al anular factura ${facturaId}: ${errMsg}`);
      throw new UnprocessableEntityException({
        message: errMsg,
        detalle: err instanceof ArcaException ? err.detalle : undefined,
      });
    }
  }

  /** Fecha yyyymmdd del CVLP original (para CbteAsoc de la NC). */
  private async resolveFechaCbteOriginal(
    liquidacionId: string,
    liquidacion: { updatedAt: Date; createdAt: Date },
  ): Promise<string> {
    const emitLog = await this.db.arcaLog.findFirst({
      where: { liquidacionId, exitoso: true, method: 'FECAESolicitar' },
      orderBy: { createdAt: 'asc' },
    });
    const metaFecha = (emitLog?.requestBody as PrismaAny)?.auditMetadata?.fechaCbte;
    if (typeof metaFecha === 'string' && /^\d{8}$/.test(metaFecha)) {
      return metaFecha;
    }
    const fromReq = (emitLog?.requestBody as PrismaAny)?.params?.FeCAEReq?.FeDetReq
      ?.FECAEDetRequest?.CbteFch;
    if (fromReq != null && String(fromReq).length >= 8) {
      return String(fromReq).slice(0, 8);
    }
    return formatFechaCbte(liquidacion.updatedAt ?? liquidacion.createdAt);
  }

  /** Fecha yyyymmdd de la factura original (para CbteAsoc de la NC). */
  private async resolveFechaCbteFacturaOriginal(
    facturaId: string,
    fechaEmision: Date,
  ): Promise<string> {
    const emitLog = await this.db.arcaLog.findFirst({
      where: { facturaId, exitoso: true, method: 'FECAESolicitar' },
      orderBy: { createdAt: 'asc' },
    });
    const metaFecha = (emitLog?.requestBody as PrismaAny)?.auditMetadata
      ?.fechaCbte;
    if (typeof metaFecha === 'string' && /^\d{8}$/.test(metaFecha)) {
      return metaFecha;
    }
    const fromReq = (emitLog?.requestBody as PrismaAny)?.params?.FeCAEReq
      ?.FeDetReq?.FECAEDetRequest?.CbteFch;
    if (fromReq != null && String(fromReq).length >= 8) {
      return String(fromReq).slice(0, 8);
    }
    return formatFechaCbte(fechaEmision);
  }

  async getConfig(tenantId: string) {
    return this.arcaConfig.findPublic(tenantId);
  }

  async upsertConfig(
    tenantId: string,
    dto: import('./dto/upsert-arca-config.dto').UpsertArcaConfigDto,
    opts?: { allowAmbienteChange?: boolean },
  ) {
    return this.arcaConfig.upsert(tenantId, dto, opts);
  }

  async uploadLogo(tenantId: string, file: Express.Multer.File) {
    const isImage = file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.originalname);
    if (!isImage) {
      throw new BadRequestException('El logo debe ser una imagen JPG, PNG o WEBP.');
    }
    return this.arcaConfig.uploadLogo(tenantId, file.buffer, file.originalname, file.mimetype);
  }

  async removeLogo(tenantId: string) {
    return this.arcaConfig.removeLogo(tenantId);
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
    await syncLiquidacionEstadoViajes(this.db, tenantId, viajeIds);
  }

  async findAll(tenantId: string, estado?: string) {
    const rows = await this.prisma.liquidacion.findMany({
      where: { tenantId, ...(estado ? { estado } : {}) },
      include: {
        transportista: { select: { id: true, nombre: true, idFiscal: true } },
        viajes: { select: { viajeId: true, subtotal: true, tnDestino: true } },
        conceptosLineas: { orderBy: { orden: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return attachAnuladoPorNombres(this.clerkUsers, rows);
  }

  async findById(tenantId: string, id: string) {
    const liq = await this.prisma.liquidacion.findUnique({
      where: { id },
      include: {
        transportista: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            condicionIva: true,
            condicionTributaria: true,
            domicilio: true,
            pais: true,
          },
        },
        viajes: {
          include: {
            viaje: {
              select: {
                id: true,
                numero: true,
                numeroIdentificacionPersonalizado: true,
                fechaCarga: true,
                fechaDescarga: true,
                origen: true,
                destino: true,
                cliente: {
                  select: {
                    id: true,
                    nombre: true,
                    idFiscal: true,
                    direccion: true,
                    pais: true,
                    condicionTributaria: true,
                  },
                },
              },
            },
          },
        },
        conceptosLineas: { orderBy: { orden: 'asc' } },
      },
    });
    if (!liq || liq.tenantId !== tenantId) {
      throw new NotFoundException('Liquidación no encontrada');
    }
    const [withNombre] = await attachAnuladoPorNombres(this.clerkUsers, [liq]);
    return withNombre;
  }

  // ── Facturas A/B via ARCA ──────────────────────────────────────────────────

  async emitirFacturaArca(tenantId: string, facturaId: string, dto: EmitirFacturaArcaDto) {
    const facturaRaw = await this.prisma.factura.findUnique({
      where: { id: facturaId },
      include: {
        viajes: {
          select: {
            id: true,
            numero: true,
            numeroIdentificacionPersonalizado: true,
            monto: true,
            cantidadFactura: true,
            precioUnitarioFactura: true,
            origen: true,
            destino: true,
          },
        },
        cliente: {
          select: {
            id: true,
            nombre: true,
            idFiscal: true,
            direccion: true,
            condicionIva: true,
          },
        },
      },
    });

    if (!facturaRaw || facturaRaw.tenantId !== tenantId) {
      throw new NotFoundException('Factura no encontrada');
    }

    const facturaExt = facturaRaw as typeof facturaRaw & {
      arcaEstado?: string | null;
      cbteTipo?: number | null;
      cbteNro?: number | null;
      ptoVenta?: number | null;
      cae?: string | null;
      caeFechaVto?: Date | null;
      arcaError?: string | null;
    };

    if (facturaExt.arcaEstado === 'autorizado' || facturaExt.cae) {
      throw new ConflictException('La factura ya tiene CAE autorizado');
    }
    if (facturaRaw.tipo !== 'cliente') {
      throw new BadRequestException(
        'Solo se pueden emitir facturas de tipo cliente por ARCA.',
      );
    }
    if (facturaRaw.moneda === 'USD') {
      throw new BadRequestException(
        'No se pueden emitir facturas en USD por ARCA.',
      );
    }
    if (!facturaRaw.cliente) {
      throw new BadRequestException('La factura no tiene un cliente asociado.');
    }

    const config = await this.arcaConfig.findWithApiKey(tenantId);
    const ambiente = config.ambiente as 'homologacion' | 'produccion';
    const esHomologacion = ambiente !== 'produccion';

    assertFacturaEmitDatosCompletos({
      emisor: config,
      cliente: facturaRaw.cliente,
    });

    const cbteTipoFinal = getCbteTipoFactura(facturaRaw.cliente.condicionIva);
    const ivaPctDefault = resolveIvaPct(facturaRaw.ivaPct ?? config.ivaGastosAdmin);

    const lineasInput: FacturaLineaInput[] =
      dto.lineas && dto.lineas.length > 0
        ? dto.lineas.map((l) => ({
            descripcion: l.descripcion,
            importe: l.importe,
            ivaPct: l.ivaPct,
          }))
        : defaultFacturaLineas(facturaRaw, facturaRaw.viajes);

    if (lineasInput.length === 0 || lineasInput.every((l) => l.importe === 0)) {
      throw new BadRequestException(
        'La factura no tiene líneas con importe para emitir.',
      );
    }

    const conceptos = buildFacturaConceptosList(lineasInput, ivaPctDefault);
    const importeNeto = round2(
      conceptos.reduce((s, c) => s + c.importe, 0),
    );

    // Marcar como pendiente antes de llamar a AFIP SDK
    await (this.prisma as PrismaAny).factura.update({
      where: { id: facturaId },
      data: {
        cbteTipo: cbteTipoFinal,
        ptoVenta: config.ptoVentaFactura,
        arcaEstado: 'pendiente_cae',
        arcaError: null,
        importe: importeNeto,
      },
    });
    const viajeIdsFactura = facturaRaw.viajes.map((v) => v.id);
    await syncFacturacionEstadoViajes(this.db, tenantId, viajeIdsFactura);

    try {
      let cbteNro: number;
      let fechaCbte: string;
      let response: import('./types/arca.types').ArcaAutorizarResponse;

      const docNroReal = facturaRaw.cliente.idFiscal
        ? Number(facturaRaw.cliente.idFiscal.replace(/-/g, ''))
        : 0;
      const condicionIvaReceptorId = facturaRaw.cliente.condicionIva ?? 5;
      const receptor = resolveReceptorAfip({
        ambiente,
        cbteTipo: cbteTipoFinal,
        docNroReal,
        condicionIvaReceptorId,
      });

      // Mismo camino que CVLP / anulación NC: FECAESolicitar vía autorizarComprobante.
      // Homologación no usa createNextVoucher: el SDK proxy a veces responde
      // "Invalid XML Error: Unexpected close tag" en ese helper.
      const { CbteNro: ultimoCbte } = await this.arcaClient.getUltimoComprobante(
        config.apiKey,
        config.cuitEmisor,
        ambiente,
        config.ptoVentaFactura,
        cbteTipoFinal,
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
      );
      cbteNro = ultimoCbte + 1;

      const ultimoFecha =
        esHomologacion && ultimoCbte > 0
          ? await this.arcaClient.getFechaComprobanteAutorizado(
              config.apiKey,
              config.cuitEmisor,
              ambiente,
              config.ptoVentaFactura,
              cbteTipoFinal,
              ultimoCbte,
              config.certPem,
              config.keyPem,
            )
          : null;
      fechaCbte = resolveFechaCbteEmision(
        ambiente,
        facturaRaw.fechaEmision,
        ultimoFecha,
      );

      if (!esHomologacion) {
        if (facturaExt.cbteNro != null) {
          this.validarCorrelatividad(facturaExt.cbteNro, cbteNro, 'Factura');
        } else {
          const localCbteNro = parseNumeroFactura(facturaRaw.numero);
          if (isNaN(localCbteNro)) {
            throw new ArcaException(
              ARCA_ERROR_CODES.GENERICO,
              `El número de factura local "${facturaRaw.numero}" no es válido. Debe finalizar con el número correlativo del comprobante a autorizar (ej. "0001-00000045").`,
            );
          }
          this.validarCorrelatividad(localCbteNro, cbteNro, 'Factura');
        }
      }

      const cabeceraBase = {
        cuit: config.cuitEmisor,
        ptoVenta: config.ptoVentaFactura,
        cbteTipo: cbteTipoFinal,
        cbteNro,
        fechaCbte,
        concepto: 1,
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaReceptorId: receptor.condicionIvaReceptorId,
      };
      const comprobante = buildComprobanteCvlp(cabeceraBase, conceptos, ivaPctDefault);
      const arcaRequest = mapCvlpToArcaRequest(comprobante, ambiente);

      if (esHomologacion) {
        await (this.prisma as PrismaAny).factura.update({
          where: { id: facturaId },
          data: { cbteNro, fechaEmision: parseAfipDate(fechaCbte) },
        });
      }

      response = await this.arcaClient.autorizarComprobante(
        config.apiKey,
        arcaRequest,
        tenantId,
        undefined,
        facturaId,
        config.certPem,
        config.keyPem,
        comprobante as unknown as Record<string, unknown>,
      );

      const comprobanteFinal = buildComprobanteCvlp(
        {
          cuit: config.cuitEmisor,
          ptoVenta: config.ptoVentaFactura,
          cbteTipo: cbteTipoFinal,
          cbteNro,
          fechaCbte,
          concepto: 1,
          docTipo: receptor.docTipo,
          docNro: receptor.docNro,
          condicionIvaReceptorId: receptor.condicionIvaReceptorId,
        },
        conceptos,
        ivaPctDefault,
      );

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          cbteNro,
          cae: response.CAE,
          caeFechaVto: parseAfipDate(response.CAEFchVto),
          arcaEstado: 'autorizado',
          ambiente: config.ambiente, // 'produccion' | 'homologacion' con el que se emitió
          arcaError: null,
          importe: comprobanteFinal.impNeto,
        },
      });
      await syncFacturacionEstadoViajes(this.db, tenantId, viajeIdsFactura);

      // Generar PDF y subir a Cloudinary
      let comprobanteUrl: string | null = null;
      try {
        const { buffer, filename } = await this.facturaPdf.generate(tenantId, facturaId);
        if (this.cloudinary.isConfigured()) {
          comprobanteUrl = await this.cloudinary.uploadComprobanteArchivo(
            tenantId,
            buffer,
            filename,
            'application/pdf',
          );
          await (this.prisma as PrismaAny).factura.update({
            where: { id: facturaId },
            data: { comprobanteUrl },
          });
        } else {
          this.logger.warn(
            `[emitirFacturaArca] Cloudinary no configurado; PDF no subido para ${facturaId}`,
          );
        }
      } catch (pdfErr) {
        this.logger.error(
          `[emitirFacturaArca] Error generando/subiendo PDF para ${facturaId}: ${
            pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
          }`,
        );
      }

      return this.prisma.factura.findUnique({
        where: { id: facturaId },
        include: {
          viajes: { select: { id: true } },
          cliente: {
            select: { id: true, nombre: true, idFiscal: true, condicionIva: true },
          },
        },
      });
    } catch (err) {
      const isConectividad =
        err instanceof ArcaException && err.code === ARCA_ERROR_CODES.CONECTIVIDAD;
      const errMsg =
        err instanceof ArcaException
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      await (this.prisma as PrismaAny).factura.update({
        where: { id: facturaId },
        data: {
          arcaEstado: isConectividad ? 'pendiente_cae' : 'error',
          arcaError: errMsg,
        },
      });
      await syncFacturacionEstadoViajes(this.db, tenantId, viajeIdsFactura);

      if (isConectividad) {
        this.logger.warn(
          `[emitirFacturaArca] ${facturaId} pendiente_cae por fallo de conectividad`,
        );
        return this.prisma.factura.findUnique({ where: { id: facturaId } });
      }

      this.logger.error(`Error al emitir factura ${facturaId}: ${errMsg}`);
      throw new UnprocessableEntityException({
        message: errMsg,
        detalle: err instanceof ArcaException ? err.detalle : undefined,
      });
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
        viaje: { select: { numero: true, numeroIdentificacionPersonalizado: true } },
      },
    });
    if (!existentes.length) return;

    const numeros = existentes
      .map((lv) => (lv.viaje ? numeroVisibleViaje(lv.viaje) : undefined))
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
