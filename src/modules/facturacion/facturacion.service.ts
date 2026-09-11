import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { CloudinaryService } from "../../shared/storage/cloudinary.service";
import { CreateFacturaDto } from "./dto/create-factura.dto";
import { UpdateFacturaDto } from "./dto/update-factura.dto";
import { FacturaTramoDto } from "./dto/factura-tramo.dto";
import { CreatePagoDto } from "./dto/create-pago.dto";
import { FacturasPaginatedQueryDto } from "./dto/facturas-paginated-query.dto";
import {
  cobroOptsDeFactura,
  computeEstadoFacturaLectura,
  FacturaTramoCobro,
  importeNetoFactura,
  importeOperativoFactura,
  ivaMontoDeTramos,
  roundMoney2,
} from "./factura-estado-lectura";
import { syncFacturacionEstadoViajes } from "../viajes/viaje-estado-financiero";
import { attachAnuladoPorNombres } from "../../shared/util/anulado-por-nombre.util";
import { ClerkVialtoRoleService } from "../../core/auth/clerk-vialto-role.service";

/** Transacciones con varios writes + Neon pueden superar el default de 5s de Prisma. */
const FACTURA_INTERACTIVE_TX = { timeout: 20_000, maxWait: 10_000 } as const;

type ViajeSnap = {
  id: string;
  facturacionEstado: string;
  monto: number | null;
  monedaMonto: string;
  cantidadFactura: number | null;
  precioUnitarioFactura: number | null;
};

function importeNetoViaje(v: {
  monto: number | null;
  cantidadFactura?: number | null;
  precioUnitarioFactura?: number | null;
}): number {
  if (v.cantidadFactura != null && v.precioUnitarioFactura != null) {
    return Math.round(v.cantidadFactura * v.precioUnitarioFactura * 100) / 100;
  }
  return v.monto ?? 0;
}

type TramoSnap = {
  id: string;
  viajeId: string;
  detalle: string;
  monto: number;
  ivaPct: number;
  orden: number;
};

@Injectable()
export class FacturacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly clerkUsers: ClerkVialtoRoleService,
  ) {}

  private computeImporte(
    viajes: Array<{
      monto: number | null;
      cantidadFactura?: number | null;
      precioUnitarioFactura?: number | null;
    }>,
  ): number {
    return viajes.reduce((sum, v) => sum + importeNetoViaje(v), 0);
  }

  /**
   * Neto = suma completa de viajes. IVA persistido solo en por-tramo sin ARCA.
   * La parte no cubierta por tramos usa el IVA de cabecera (0% = exento).
   */
  private montosParaGuardar(
    viajes: Array<{
      monto: number | null;
      cantidadFactura?: number | null;
      precioUnitarioFactura?: number | null;
    }>,
    tramos: FacturaTramoCobro[],
    facturarPorTramo: boolean,
    ivaPctCabecera: number | null | undefined,
    tieneArca: boolean,
  ): { importe: number; ivaMonto: number | null } {
    const importe = roundMoney2(this.computeImporte(viajes));
    if (!facturarPorTramo || tieneArca || tramos.length === 0) {
      return { importe, ivaMonto: null };
    }
    return {
      importe,
      ivaMonto: ivaMontoDeTramos(importe, tramos, ivaPctCabecera),
    };
  }

  private assertTramosValidos(
    viajeIds: string[],
    tramos: FacturaTramoDto[] | undefined,
    facturarPorTramo: boolean,
  ): FacturaTramoDto[] {
    if (!facturarPorTramo) return [];
    if (!tramos || tramos.length < 1) {
      throw new BadRequestException(
        "Para facturar por tramo tenés que cargar al menos un tramo.",
      );
    }
    const allowed = new Set(viajeIds);
    for (const t of tramos) {
      if (!allowed.has(t.viajeId)) {
        throw new BadRequestException(
          "Cada tramo debe pertenecer a un viaje de la factura.",
        );
      }
      if (!t.detalle?.trim()) {
        throw new BadRequestException("El detalle de cada tramo es obligatorio.");
      }
      if (!(t.monto > 0)) {
        throw new BadRequestException("El monto de cada tramo debe ser mayor a 0.");
      }
      if (t.ivaPct == null || t.ivaPct < 0) {
        throw new BadRequestException("El IVA de cada tramo debe ser 0 o mayor.");
      }
    }
    return tramos.map((t) => ({
      viajeId: t.viajeId,
      detalle: t.detalle.trim(),
      monto: t.monto,
      ivaPct: t.ivaPct,
    }));
  }

  private async replaceTramos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    facturaId: string,
    tramos: FacturaTramoDto[],
  ): Promise<void> {
    await tx.facturaTramo.deleteMany({ where: { facturaId, tenantId } });
    if (tramos.length === 0) return;
    await tx.facturaTramo.createMany({
      data: tramos.map((t, i) => ({
        tenantId,
        facturaId,
        viajeId: t.viajeId,
        detalle: t.detalle,
        monto: t.monto,
        ivaPct: t.ivaPct,
        orden: i,
      })),
    });
  }

  private async tieneArca(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    return tenant?.modules.includes("emision-facturas-arca") ?? false;
  }

  private toShape(
    row: {
      id: string;
      tenantId: string;
      numero: string;
      tipo: string;
      clienteId: string | null;
      transportistaId: string | null;
      importe: number;
      moneda: string;
      fechaEmision: Date;
      fechaVencimiento: Date | null;
      estado: string;
      arcaEstado: string | null;
      ambiente: string | null;
      anuladoPor: string | null;
      diferencia: number | null;
      ivaPct?: number | null;
      ivaMonto?: number | null;
      facturarPorTramo?: boolean;
      createdAt: Date;
      viajes: ViajeSnap[];
      pagos?: { importe: number }[];
      tramos?: TramoSnap[];
    },
    tieneArca: boolean,
  ) {
    const { viajes, pagos = [], tramos = [], ...f } = row;
    const cobroOpts = cobroOptsDeFactura(
      {
        facturarPorTramo: f.facturarPorTramo,
        ivaPct: f.ivaPct,
        tramos,
        ivaMonto: f.ivaMonto,
      },
      tieneArca,
    );
    const importe = importeNetoFactura(f.importe, viajes, cobroOpts);
    const importeACobrar = importeOperativoFactura(f.importe, viajes, cobroOpts);
    const totalPagado = pagos.reduce((s, p) => s + p.importe, 0);
    const { estado, cobrado, vencida } = computeEstadoFacturaLectura({
      viajes,
      fechaVencimiento: f.fechaVencimiento,
      importeGuardado: f.importe,
      pagos,
      arcaEstado: f.arcaEstado,
      tieneArca,
      facturarPorTramo: cobroOpts.facturarPorTramo,
      tramos,
      ivaPctCabecera: f.ivaPct,
      ivaMontoGuardado: f.ivaMonto,
    });
    const tramosOrdenados = [...tramos].sort((a, b) => a.orden - b.orden);
    return {
      ...f,
      facturarPorTramo: f.facturarPorTramo ?? false,
      ivaMonto: f.ivaMonto ?? null,
      viajeIds: viajes.map((v) => v.id),
      tramos: tramosOrdenados.map((t) => ({
        id: t.id,
        viajeId: t.viajeId,
        detalle: t.detalle,
        monto: t.monto,
        ivaPct: t.ivaPct,
        orden: t.orden,
      })),
      importe,
      importeACobrar,
      saldoPendiente: Math.max(0, roundMoney2(importeACobrar - totalPagado)),
      estado,
      cobrado,
      vencida,
    };
  }

  /** `toShape` + resolución de `anuladoPorNombre` (Clerk userId → nombre legible). */
  private async shapeConNombre(
    row: Parameters<FacturacionService["toShape"]>[0],
    tieneArca: boolean,
  ) {
    const shaped = this.toShape(row, tieneArca);
    await this.alignViajesCobroPorTramo(row, tieneArca, shaped.cobrado);
    const [withNombre] = await attachAnuladoPorNombres(this.clerkUsers, [
      shaped,
    ]);
    return withNombre;
  }

  private async shapeManyConNombre(
    rows: Parameters<FacturacionService["toShape"]>[0][],
    tieneArca: boolean,
  ) {
    const shaped = rows.map((r) => this.toShape(r, tieneArca));
    await Promise.all(
      rows.map((row, i) =>
        this.alignViajesCobroPorTramo(row, tieneArca, shaped[i].cobrado),
      ),
    );
    return attachAnuladoPorNombres(this.clerkUsers, shaped);
  }

  /** Recalcula viajes de facturas por tramo (sin ARCA) según pagos vs. total con IVA. */
  private async alignViajesCobroPorTramo(
    row: Parameters<FacturacionService["toShape"]>[0],
    tieneArca: boolean,
    cobrado: boolean,
  ): Promise<void> {
    if (tieneArca || !row.facturarPorTramo || (row.tramos?.length ?? 0) === 0) {
      return;
    }
    const allCobrado =
      row.viajes.length > 0 &&
      row.viajes.every((v) => v.facturacionEstado === "cobrado");
    const noneCobrado = row.viajes.every(
      (v) => v.facturacionEstado !== "cobrado",
    );
    if ((cobrado && allCobrado) || (!cobrado && noneCobrado)) return;
    await syncFacturacionEstadoViajes(
      this.prisma,
      row.tenantId,
      row.viajes.map((v) => v.id),
      { cobrado },
    );
  }

  private async assertClienteCtx(tenantId: string, clienteId?: string | null) {
    if (clienteId) {
      const c = await this.prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
      });
      if (!c) throw new BadRequestException("Cliente inválido");
    }
  }

  private async assertTransportistaCtx(
    tenantId: string,
    transportistaId?: string | null,
  ) {
    if (transportistaId) {
      const t = await this.prisma.transportista.findFirst({
        where: { id: transportistaId, tenantId },
      });
      if (!t) throw new BadRequestException("Transportista inválido");
    }
  }

  private async assertNumeroFacturaUnico(
    tenantId: string,
    numero: string,
    excludeId?: string,
  ) {
    const existe = await this.prisma.factura.findFirst({
      where: {
        tenantId,
        numero,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existe) {
      throw new BadRequestException(
        "No se pudo guardar la factura. El número de comprobante ingresado ya se encuentra registrado.",
      );
    }
  }

  private async resolveViajes(
    tenantId: string,
    viajeIds: string[],
    clienteId?: string,
  ): Promise<ViajeSnap[]> {
    if (viajeIds.length === 0) return [];
    const rows = await this.prisma.viaje.findMany({
      where: { id: { in: viajeIds }, tenantId },
      select: {
        id: true,
        facturacionEstado: true,
        monto: true,
        monedaMonto: true,
        cantidadFactura: true,
        precioUnitarioFactura: true,
        clienteId: true,
        clientesViaje: {
          select: {
            clienteId: true,
            monto: true,
            monedaMonto: true,
            cantidad: true,
            precioUnitario: true,
          }
        }
      },
    });
    if (rows.length !== viajeIds.length) {
      throw new BadRequestException(
        "Uno o más viajes inválidos para este tenant",
      );
    }
    
    return rows.map(r => {
      // Si el clienteId solicitado pertenece a un cliente secundario del viaje, usamos sus montos.
      if (clienteId && r.clienteId !== clienteId && r.clientesViaje) {
        const vc = r.clientesViaje.find(c => c.clienteId === clienteId);
        if (vc) {
          return {
            id: r.id,
            facturacionEstado: r.facturacionEstado,
            monto: vc.monto,
            monedaMonto: vc.monedaMonto,
            cantidadFactura: vc.cantidad,
            precioUnitarioFactura: vc.precioUnitario,
          };
        }
      }
      return {
        id: r.id,
        facturacionEstado: r.facturacionEstado,
        monto: r.monto,
        monedaMonto: r.monedaMonto,
        cantidadFactura: r.cantidadFactura,
        precioUnitarioFactura: r.precioUnitarioFactura,
      };
    });
  }

  private assertMonedaUnica(viajes: { monedaMonto: string }[]): string {
    if (viajes.length === 0) return "ARS";
    const monedas = new Set(viajes.map((v) => v.monedaMonto ?? "ARS"));
    if (monedas.size > 1) {
      throw new BadRequestException(
        "Una factura no puede contener viajes en distintas monedas. Generá una factura por moneda.",
      );
    }
    return [...monedas][0];
  }

  private readonly VIAJE_SELECT = {
    id: true,
    facturacionEstado: true,
    monto: true,
    monedaMonto: true,
    cantidadFactura: true,
    precioUnitarioFactura: true,
  } as const;
  private readonly PAGO_SELECT = { importe: true } as const;
  private readonly TRAMO_SELECT = {
    id: true,
    viajeId: true,
    detalle: true,
    monto: true,
    ivaPct: true,
    orden: true,
  } as const;
  private readonly FACTURA_INCLUDE = {
    viajes: { select: this.VIAJE_SELECT },
    clientesViaje: { select: { viajeId: true } },
    pagos: { select: this.PAGO_SELECT },
    tramos: { select: this.TRAMO_SELECT, orderBy: { orden: "asc" as const } },
  };

  async uploadComprobante(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<{ url: string }> {
    const name = file.originalname.toLowerCase();
    const isPdf = file.mimetype === "application/pdf" || name.endsWith(".pdf");
    const isImage =
      file.mimetype.startsWith("image/") ||
      /\.(jpe?g|png|webp|heic|heif)$/.test(name);
    if (!isPdf && !isImage) {
      throw new BadRequestException(
        "El comprobante debe ser un PDF o una imagen.",
      );
    }
    const url = await this.cloudinary.uploadComprobanteArchivo(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }

  private buildFacturasWhere(
    tenantId: string,
    query: Pick<
      FacturasPaginatedQueryDto,
      | "numero"
      | "tipo"
      | "clienteId"
      | "viajeId"
      | "emisionDesde"
      | "emisionHasta"
      | "vencimientoDesde"
      | "vencimientoHasta"
    >,
  ): Prisma.FacturaWhereInput {
    const where: Prisma.FacturaWhereInput = { tenantId };

    if (query.numero?.trim()) {
      where.numero = { contains: query.numero.trim(), mode: "insensitive" };
    }
    if (query.tipo) where.tipo = query.tipo;
    if (query.clienteId) where.clienteId = query.clienteId;

    if (query.emisionDesde || query.emisionHasta) {
      where.fechaEmision = {};
      if (query.emisionDesde) {
        where.fechaEmision.gte = new Date(
          `${query.emisionDesde}T00:00:00.000Z`,
        );
      }
      if (query.emisionHasta) {
        where.fechaEmision.lte = new Date(
          `${query.emisionHasta}T23:59:59.999Z`,
        );
      }
    }

    if (query.vencimientoDesde || query.vencimientoHasta) {
      where.fechaVencimiento = { not: null };
      if (query.vencimientoDesde) {
        where.fechaVencimiento.gte = new Date(
          `${query.vencimientoDesde}T00:00:00.000Z`,
        );
      }
      if (query.vencimientoHasta) {
        where.fechaVencimiento.lte = new Date(
          `${query.vencimientoHasta}T23:59:59.999Z`,
        );
      }
    }

    if (query.viajeId) {
      const vid = query.viajeId;
      where.OR = [
        { viajes: { some: { id: vid } } },
        { clientesViaje: { some: { viajeId: vid } } },
        { tramos: { some: { viajeId: vid } } },
      ];
    }

    return where;
  }

  private paginatedMeta(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };
  }

  async listFacturas(tenantId: string, clienteId?: string) {
    const tieneArca = await this.tieneArca(tenantId);
    const rows = await this.prisma.factura.findMany({
      where: { tenantId, ...(clienteId ? { clienteId } : {}) },
      orderBy: { fechaEmision: "desc" },
      include: this.FACTURA_INCLUDE,
      take: 200,
    });
    return this.shapeManyConNombre(rows, tieneArca);
  }

  async findAllPaginated(tenantId: string, query: FacturasPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildFacturasWhere(tenantId, query);
    const tieneArca = await this.tieneArca(tenantId);
    const include = this.FACTURA_INCLUDE;

    if (query.estado) {
      const rows = await this.prisma.factura.findMany({
        where,
        orderBy: { fechaEmision: "desc" },
        include,
      });
      const shaped = await this.shapeManyConNombre(rows, tieneArca);
      const filtered = shaped.filter((f) => {
        if (query.estado === "cobrado") return f.cobrado;
        if (query.estado === "vencida") return f.vencida;
        return f.estado === query.estado;
      });
      const total = filtered.length;
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        meta: this.paginatedMeta(page, pageSize, total),
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.factura.count({ where }),
      this.prisma.factura.findMany({
        where,
        orderBy: { fechaEmision: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
    ]);

    return {
      items: await this.shapeManyConNombre(rows, tieneArca),
      meta: this.paginatedMeta(page, pageSize, total),
    };
  }

  async findFactura(id: string, tenantId: string) {
    const row = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      include: this.FACTURA_INCLUDE,
    });
    if (!row) throw new NotFoundException("Factura no encontrada");
    const tieneArca = await this.tieneArca(tenantId);
    return this.shapeConNombre(row, tieneArca);
  }

  /**
   * Cuenta corriente (cuentas por cobrar): si el tenant tiene Facturación, el cargo
   * nace de la factura emitida, no del viaje (ver `tieneFacturacion` en
   * viajes.service.ts, que por eso se abstiene de generarlo). Solo aplica a facturas
   * de cliente (`clienteId` seteado) — las de transportista quedan fuera de esta fase.
   * Idempotente por `(tenantId, facturaId)`, igual que el cargo de viaje lo es por
   * `(tenantId, viajeId, contraparteId)`.
   */
  private async upsertCargoFactura(
    tx: Prisma.TransactionClient,
    factura: {
      id: string;
      tenantId: string;
      clienteId: string | null;
      numero: string | null;
      importe: number;
      moneda: string;
      fechaEmision: Date;
      fechaVencimiento: Date | null;
    },
  ) {
    if (!factura.clienteId) return;
    const concepto = `Cargo automático por factura ${factura.numero ?? factura.id}`;
    await tx.movimientoCuentaCorriente.upsert({
      where: { tenantId_facturaId: { tenantId: factura.tenantId, facturaId: factura.id } },
      update: {
        clienteId: factura.clienteId,
        contraparteId: factura.clienteId,
        tipo: "cargo",
        origen: "factura",
        concepto,
        importe: factura.importe,
        moneda: factura.moneda,
        fecha: factura.fechaEmision,
        fechaVencimiento: factura.fechaVencimiento,
        numeroComprobante: factura.numero,
        estadoDisponibilidad: "pendiente",
      },
      create: {
        tenantId: factura.tenantId,
        clienteId: factura.clienteId,
        contraparteId: factura.clienteId,
        facturaId: factura.id,
        tipo: "cargo",
        origen: "factura",
        concepto,
        importe: factura.importe,
        moneda: factura.moneda,
        fecha: factura.fechaEmision,
        fechaVencimiento: factura.fechaVencimiento,
        numeroComprobante: factura.numero,
      },
    });
  }

  /**
   * Reversión análoga a `revertirCargoFinalizacionSiCorresponde` (viajes): al anular o
   * eliminar una factura, el cargo que había generado se marca `anulado` en vez de
   * borrarse, salvo que ya tenga imputaciones (pagos aplicados) — ese caso requiere
   * intervención manual, no se toca solo.
   */
  private async revertirCargoFacturaSiCorresponde(
    tx: Prisma.TransactionClient,
    tenantId: string,
    facturaId: string,
  ) {
    const cargo = await tx.movimientoCuentaCorriente.findFirst({
      where: { tenantId, facturaId, tipo: "cargo", estadoDisponibilidad: { not: "anulado" } },
    });
    if (!cargo) return;
    const imputado = await tx.imputacionCuentaCorriente.aggregate({
      where: { cargoId: cargo.id },
      _sum: { importe: true },
    });
    if ((imputado._sum.importe ?? 0) > 0) return;
    await tx.movimientoCuentaCorriente.update({
      where: { id: cargo.id },
      data: { estadoDisponibilidad: "anulado" },
    });
  }

  async createFactura(tenantId: string, dto: CreateFacturaDto) {
    await this.assertClienteCtx(tenantId, dto.clienteId);
    await this.assertTransportistaCtx(tenantId, dto.transportistaId);

    const tieneArca = await this.tieneArca(tenantId);

    // El número de comprobante es opcional: para tenants con integracion-arca
    // lo asigna AFIP al emitir (cbteTipo/ptoVenta/cbteNro); para tenants sin
    // ARCA es un comprobante externo que puede cargarse después.
    // Normalizamos acá (no solo confiar en el frontend) para que un string
    // vacío/solo-espacios nunca llegue a guardarse como numero="" — eso
    // rompería la unicidad real (NULL sí admite múltiples filas, "" no).
    const numero = dto.numero?.trim() || null;
    if (numero) {
      // Validación previa para atrapar el 99% de los casos antes de abrir transacción
      await this.assertNumeroFacturaUnico(tenantId, numero);
    }

    const viajeIds = dto.viajeIds ?? [];
    const viajes = await this.resolveViajes(tenantId, viajeIds, dto.clienteId);
    const moneda = this.assertMonedaUnica(viajes);
    const facturarPorTramo = dto.facturarPorTramo === true;
    const tramosValidos = this.assertTramosValidos(
      viajeIds,
      dto.tramos,
      facturarPorTramo,
    );
    const ivaPct = dto.ivaPct ?? 21;
    const { importe, ivaMonto } = this.montosParaGuardar(
      viajes,
      tramosValidos,
      facturarPorTramo,
      ivaPct,
      tieneArca,
    );

    try {
      // Retornamos el resultado de la transacción esperando su resolución con 'await'
      return await this.prisma.$transaction(async (tx) => {
        const factura = await tx.factura.create({
          data: {
            tenantId,
            numero,
            tipo: dto.tipo,
            clienteId: dto.clienteId ?? null,
            transportistaId: dto.transportistaId ?? null,
            importe,
            ivaMonto,
            moneda,
            fechaEmision: new Date(dto.fechaEmision),
            fechaVencimiento: dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null,
            estado: "pendiente",
            diferencia: dto.diferencia ?? null,
            ivaPct,
            facturarPorTramo,
            comprobanteUrl: dto.comprobanteUrl ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        });

        await this.upsertCargoFactura(tx, factura);

        if (viajeIds.length > 0) {
          if (dto.clienteId) {
            await tx.viajeCliente.updateMany({
              where: {
                tenantId,
                viajeId: { in: viajeIds },
                clienteId: dto.clienteId,
              },
              data: {
                facturaId: factura.id,
                facturacionEstado: "facturado",
              },
            });
          }

          const viajesInvolucrados = await tx.viaje.findMany({
            where: { id: { in: viajeIds }, tenantId },
            select: { id: true, clienteId: true, facturaId: true },
          });

          for (const v of viajesInvolucrados) {
            // Viaje.facturaId (→ Viaje.facturacionEstado) representa específicamente
            // al cliente principal (Viaje.clienteId), independiente de cada
            // ViajeCliente.facturaId. Solo se actualiza si esta factura es del
            // cliente principal, o si no se especificó cliente (retrocompatibilidad
            // con flujos sin desglose multi-cliente). Ojo: NO cae acá solo porque
            // `!v.facturaId` — eso pisaba la cabecera con la factura de un cliente
            // ADICIONAL en un viaje multi-cliente que todavía no tenía ninguna
            // factura vinculada, marcando al principal como facturado sin serlo
            // (bug real: viaje con 3 clientes, se factura solo al 2do, y el
            // principal aparecía como "facturado" en vez de "sin facturar").
            if (v.clienteId === dto.clienteId || !dto.clienteId) {
              await tx.viaje.update({
                where: { id: v.id },
                data: { facturaId: factura.id },
              });
            }
          }

          await syncFacturacionEstadoViajes(tx, tenantId, viajeIds);
        }

        if (facturarPorTramo) {
          await this.replaceTramos(tx, tenantId, factura.id, tramosValidos);
        }

        const updated = await tx.factura.findFirst({
          where: { id: factura.id },
          include: this.FACTURA_INCLUDE,
        });

        return this.toShape(updated!, tieneArca);
      }, FACTURA_INTERACTIVE_TX);
    } catch (error) {
      // Capturamos el error P2002 de Prisma (Unique constraint failed)
      // para evitar el Error 500 en caso de una condición de carrera
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          "No se pudo guardar la factura. El número de comprobante ingresado ya se encuentra registrado.",
        );
      }

      // Si es otro tipo de error (ej. base de datos caída), dejamos que suba el 500
      throw error;
    }
  }

  async updateFactura(id: string, tenantId: string, dto: UpdateFacturaDto) {
    const existing = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      select: { facturarPorTramo: true, clienteId: true, ivaPct: true },
    });
    if (!existing) throw new NotFoundException("Factura no encontrada");

    await this.assertClienteCtx(tenantId, dto.clienteId);
    await this.assertTransportistaCtx(tenantId, dto.transportistaId);

    if (dto.numero) {
      await this.assertNumeroFacturaUnico(tenantId, dto.numero, id);
    }

    let monedaNueva: string | undefined;
    if (dto.viajeIds !== undefined && dto.viajeIds.length > 0) {
      const viajesNuevos = await this.prisma.viaje.findMany({
        where: { id: { in: dto.viajeIds }, tenantId },
        select: { id: true, monedaMonto: true },
      });
      if (viajesNuevos.length !== dto.viajeIds.length) {
        throw new BadRequestException("Uno o más viajes inválidos");
      }
      monedaNueva = this.assertMonedaUnica(viajesNuevos);
    }

    const tieneArca = await this.tieneArca(tenantId);
    return this.prisma.$transaction(async (tx) => {
      const facturarPorTramo =
        dto.facturarPorTramo !== undefined
          ? dto.facturarPorTramo === true
          : existing.facturarPorTramo;

      // Actualizar campos de la factura
      await tx.factura.update({
        where: { id },
        data: {
          ...(dto.numero !== undefined
            ? { numero: dto.numero.trim() || null }
            : {}),
          ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
          ...(dto.clienteId !== undefined
            ? { clienteId: dto.clienteId || null }
            : {}),
          ...(dto.transportistaId !== undefined
            ? { transportistaId: dto.transportistaId || null }
            : {}),
          ...(dto.diferencia !== undefined
            ? { diferencia: dto.diferencia }
            : {}),
          ...(dto.fechaEmision !== undefined
            ? { fechaEmision: new Date(dto.fechaEmision) }
            : {}),
          ...(dto.fechaVencimiento !== undefined
            ? {
                fechaVencimiento: dto.fechaVencimiento
                  ? new Date(dto.fechaVencimiento)
                  : null,
              }
            : {}),
          ...(dto.ivaPct !== undefined ? { ivaPct: dto.ivaPct } : {}),
          ...(dto.comprobanteUrl !== undefined
            ? { comprobanteUrl: dto.comprobanteUrl || null }
            : {}),
          ...(dto.facturarPorTramo !== undefined
            ? { facturarPorTramo }
            : {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });

      // Revinculación de viajes si se indica
      if (dto.viajeIds !== undefined) {
        const newIds = dto.viajeIds;

        // Obtener IDs de viajes que se van a desvincular
        const desvinculados = await tx.viaje.findMany({
          where: { facturaId: id, tenantId, id: { notIn: newIds } },
          select: { id: true },
        });
        const idsDesvinculados = desvinculados.map((v) => v.id);

        if (idsDesvinculados.length > 0) {
          await tx.viaje.updateMany({
            where: { id: { in: idsDesvinculados }, tenantId },
            data: { facturaId: null },
          });
          await tx.viajeCliente.updateMany({
            where: { viajeId: { in: idsDesvinculados }, tenantId, facturaId: id },
            data: { facturaId: null, facturacionEstado: "sin_facturar" },
          });
          await syncFacturacionEstadoViajes(tx, tenantId, idsDesvinculados);
        }

        if (newIds.length > 0) {
          const targetClienteId = dto.clienteId ?? existing.clienteId ?? undefined;
          if (targetClienteId) {
            await tx.viajeCliente.updateMany({
              where: {
                tenantId,
                viajeId: { in: newIds },
                clienteId: targetClienteId,
              },
              data: {
                facturaId: id,
                facturacionEstado: "facturado",
              },
            });
          }

          const viajesInvolucrados = await tx.viaje.findMany({
            where: { id: { in: newIds }, tenantId },
            select: { id: true, clienteId: true, facturaId: true },
          });

          for (const v of viajesInvolucrados) {
            // Mismo criterio que createFactura: Viaje.facturaId representa al
            // cliente principal. `v.facturaId === id` es legítimo (el viaje ya
            // estaba vinculado a esta misma factura); `!targetClienteId` es la
            // retrocompatibilidad sin desglose. NO cae por `!v.facturaId` solo
            // (ver bug real documentado en createFactura más arriba).
            if (
              v.clienteId === targetClienteId ||
              !targetClienteId ||
              v.facturaId === id
            ) {
              await tx.viaje.update({
                where: { id: v.id },
                data: { facturaId: id },
              });
            }
          }

          await syncFacturacionEstadoViajes(tx, tenantId, newIds);
        }
      }

      const viajeIdsActualesRows = await tx.viaje.findMany({
        where: { facturaId: id, tenantId },
        select: { id: true },
      });
      const viajeIdsActuales = viajeIdsActualesRows.map((v) => v.id);
      
      const viajes = await this.resolveViajes(tenantId, viajeIdsActuales, dto.clienteId ?? existing.clienteId ?? undefined);

      let tramosForImporte: FacturaTramoCobro[] = [];
      if (facturarPorTramo) {
        const turningOn =
          dto.facturarPorTramo === true && !existing.facturarPorTramo;
        if (dto.tramos !== undefined || turningOn) {
          const validados = this.assertTramosValidos(
            viajeIdsActuales,
            dto.tramos,
            true,
          );
          await this.replaceTramos(tx, tenantId, id, validados);
          tramosForImporte = validados;
        } else {
          // Mode already on; prune orphans if viajeIds changed
          const existentes = await tx.facturaTramo.findMany({
            where: { facturaId: id, tenantId },
            select: {
              viajeId: true,
              detalle: true,
              monto: true,
              ivaPct: true,
            },
            orderBy: { orden: "asc" },
          });
          const allowed = new Set(viajeIdsActuales);
          const filtrados = existentes.filter((t) => allowed.has(t.viajeId));
          if (filtrados.length !== existentes.length) {
            if (filtrados.length < 1) {
              throw new BadRequestException(
                "Para facturar por tramo tenés que cargar al menos un tramo.",
              );
            }
            await this.replaceTramos(tx, tenantId, id, filtrados);
          }
          tramosForImporte = filtrados;
        }
      } else {
        await this.replaceTramos(tx, tenantId, id, []);
      }

      const { importe, ivaMonto } = this.montosParaGuardar(
        viajes,
        tramosForImporte,
        facturarPorTramo,
        dto.ivaPct !== undefined ? dto.ivaPct : existing.ivaPct,
        tieneArca,
      );

      const updated = await tx.factura.update({
        where: { id },
        data: {
          importe,
          ivaMonto,
          ...(monedaNueva !== undefined ? { moneda: monedaNueva } : {}),
        },
        include: this.FACTURA_INCLUDE,
      });
      if (updated.clienteId) {
        await this.upsertCargoFactura(tx, updated);
      } else {
        await this.revertirCargoFacturaSiCorresponde(tx, tenantId, id);
      }
      return this.toShape(updated, tieneArca);
    }, FACTURA_INTERACTIVE_TX);
  }

  async removeFactura(id: string, tenantId: string) {
    const viajesAfectados = await this.prisma.viaje.findMany({
      where: { facturaId: id, tenantId },
      select: { id: true },
    });
    const viajesClientesAfectados = await this.prisma.viajeCliente.findMany({
      where: { facturaId: id, tenantId },
      select: { viajeId: true },
    });
    
    const viajeIds = Array.from(new Set([
      ...viajesAfectados.map((v) => v.id),
      ...viajesClientesAfectados.map((vc) => vc.viajeId),
    ]));

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.updateMany({
        where: { facturaId: id, tenantId },
        data: { facturaId: null },
      });
      await tx.viajeCliente.updateMany({
        where: { facturaId: id, tenantId },
        data: { facturaId: null },
      });
      await syncFacturacionEstadoViajes(tx, tenantId, viajeIds);
      await this.revertirCargoFacturaSiCorresponde(tx, tenantId, id);
      return tx.factura.delete({ where: { id } });
    }, FACTURA_INTERACTIVE_TX);
  }

  listPagos(tenantId: string, facturaId?: string) {
    return this.prisma.pago.findMany({
      where: { tenantId, ...(facturaId ? { facturaId } : {}) },
      orderBy: { fecha: "desc" },
      take: 200,
    });
  }

  async createPago(tenantId: string, dto: CreatePagoDto) {
    await this.findFactura(dto.facturaId, tenantId);
    const pago = await this.prisma.pago.create({
      data: {
        tenantId,
        facturaId: dto.facturaId,
        importe: dto.importe,
        fecha: new Date(dto.fecha),
        formaPago: dto.formaPago ?? null,
      },
    });
    await this.syncViajesEstadoTrasPago(dto.facturaId, tenantId);
    return pago;
  }

  /**
   * Registra un pago por el saldo pendiente de la factura (importe operativo menos
   * lo ya cobrado) con fecha de hoy, y deja que `syncViajesEstadoTrasPago` pase
   * automáticamente todos los viajes vinculados a `facturacionEstado: "cobrado"`.
   * Si ya no queda saldo, no crea un pago duplicado — devuelve `yaCobrada: true`.
   */
  async marcarComoCobrada(tenantId: string, id: string) {
    const factura = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      include: this.FACTURA_INCLUDE,
    });
    if (!factura) throw new NotFoundException("Factura no encontrada");
    const tieneArca = await this.tieneArca(tenantId);

    const importeOperativo = importeOperativoFactura(
      factura.importe,
      factura.viajes,
      cobroOptsDeFactura(factura, tieneArca),
    );
    const totalPagado = factura.pagos.reduce((s, p) => s + p.importe, 0);
    const saldo = roundMoney2(importeOperativo - totalPagado);

    if (saldo <= 0.005) {
      return { yaCobrada: true, factura: await this.shapeConNombre(factura, tieneArca) };
    }

    await this.prisma.pago.create({
      data: {
        tenantId,
        facturaId: id,
        importe: saldo,
        fecha: new Date(),
        formaPago: null,
      },
    });
    await this.syncViajesEstadoTrasPago(id, tenantId);

    const updated = await this.prisma.factura.findFirst({
      where: { id, tenantId },
      include: this.FACTURA_INCLUDE,
    });
    return { yaCobrada: false, factura: await this.shapeConNombre(updated!, tieneArca) };
  }

  async removePago(id: string, tenantId: string) {
    const row = await this.prisma.pago.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Pago no encontrado");
    await this.prisma.pago.delete({ where: { id } });
    await this.syncViajesEstadoTrasPago(row.facturaId, tenantId);
    return row;
  }

  /**
   * Espejo del cobro en Facturación cuando se imputa un pago a un cargo de Cuenta
   * Corriente vinculado a una factura real (`facturaId`). Mantiene unificados ambos
   * módulos: reutiliza exactamente la misma lógica de `marcarComoCobrada` (crea un
   * `Pago` y resincroniza `Factura`/`Viaje.facturacionEstado`), así que la factura
   * queda igual de "cobrada" que si el pago se hubiera cargado desde Facturas.
   * Acepta un `tx` opcional para participar de la transacción de Cuenta Corriente
   * que la llama (ver `CuentaCorrienteService.crearImputacion`).
   */
  async registrarPagoDesdeCuentaCorriente(
    tenantId: string,
    facturaId: string,
    importe: number,
    fecha: Date,
    formaPago?: string | null,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const factura = await client.factura.findFirst({ where: { id: facturaId, tenantId } });
    if (!factura) return null;
    const pago = await client.pago.create({
      data: { tenantId, facturaId, importe, fecha, formaPago: formaPago ?? null },
    });
    await this.syncViajesEstadoTrasPago(facturaId, tenantId, client);
    return pago;
  }

  /** Contraparte de `registrarPagoDesdeCuentaCorriente`, para cuando se deshace una imputación en Cuenta Corriente. */
  async eliminarPagoDesdeCuentaCorriente(
    tenantId: string,
    pagoId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const row = await client.pago.findFirst({ where: { id: pagoId, tenantId } });
    if (!row) return;
    await client.pago.delete({ where: { id: pagoId } });
    await this.syncViajesEstadoTrasPago(row.facturaId, tenantId, client);
  }

  /**
   * Backfill histórico: recorre las facturas de cliente ya emitidas (antes de que
   * existiera esta integración) y les genera/actualiza el cargo de cuenta corriente
   * correspondiente, con su `estadoDisponibilidad` ya calculado desde los `Pago`
   * reales que tenga cada una. Idempotente (mismo `upsert` de siempre). Usado por
   * `scripts/backfill-cuenta-corriente.ts`, no se expone por HTTP.
   */
  async backfillCuentaCorriente(opts: { tenantId?: string; dryRun: boolean }) {
    const resultados: string[] = [];
    const facturas = await this.prisma.factura.findMany({
      where: {
        clienteId: { not: null },
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      include: this.FACTURA_INCLUDE,
    });

    for (const factura of facturas) {
      try {
        const existe = await this.prisma.movimientoCuentaCorriente.findFirst({
          where: { tenantId: factura.tenantId, facturaId: factura.id },
        });
        const totalPagado = factura.pagos.reduce((s, p) => s + p.importe, 0);
        resultados.push(
          `[factura] ${factura.tenantId} ${factura.numero ?? factura.id} → ${existe ? "update" : "CREATE"} ` +
            `$${factura.importe} (pagado: $${totalPagado})`,
        );
        if (!opts.dryRun) {
          await this.prisma.$transaction((tx) => this.upsertCargoFactura(tx, factura));
          await this.syncViajesEstadoTrasPago(factura.id, factura.tenantId);
        }
      } catch (e) {
        resultados.push(
          `[factura] ${factura.tenantId} ${factura.numero ?? factura.id} → ⚠️ SKIP (${e instanceof Error ? e.message : String(e)})`,
        );
      }
    }

    return resultados;
  }

  /** Alinea estado de viajes vinculados con cobro total o parcial de la factura. */
  private async syncViajesEstadoTrasPago(
    facturaId: string,
    tenantId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const factura = await client.factura.findFirst({
      where: { id: facturaId, tenantId },
      include: this.FACTURA_INCLUDE,
    });
    if (!factura) return;

    const tieneArca = await this.tieneArca(tenantId);
    const { cobrado } = computeEstadoFacturaLectura({
      viajes: factura.viajes,
      fechaVencimiento: factura.fechaVencimiento,
      importeGuardado: factura.importe,
      pagos: factura.pagos,
      arcaEstado: factura.arcaEstado,
      tieneArca,
      facturarPorTramo: factura.facturarPorTramo,
      tramos: factura.tramos,
      ivaPctCabecera: factura.ivaPct,
      ivaMontoGuardado: factura.ivaMonto,
    });

    const viajeIds = Array.from(new Set([
      ...factura.viajes.map((v) => v.id),
      ...factura.clientesViaje.map((vc) => vc.viajeId),
    ]));

    await syncFacturacionEstadoViajes(
      client,
      tenantId,
      viajeIds,
      { cobrado, facturaId },
    );

    // Mantiene el cargo de Cuenta Corriente (si existe) alineado con TODOS los pagos
    // de la factura, no solo los que llegaron vía CC — cubre tanto el pago hecho
    // directamente en Facturas (createPago/marcarComoCobrada, sin pasar por CC) como
    // el caso de un tenant que todavía no tiene el módulo Cuenta Corriente
    // contratado: el cargo se sigue generando y actualizando en segundo plano
    // (RequireModule lo oculta de la API), así que el día que contrate el módulo ve
    // el estado real sin ninguna migración — el saldo pagado siempre se recalculó
    // en vivo desde acá, nunca dependió de que existiera Cuenta Corriente.
    const totalPagado = factura.pagos.reduce((s, p) => s + p.importe, 0);
    await client.movimientoCuentaCorriente.updateMany({
      where: { tenantId, facturaId, tipo: 'cargo' },
      data: {
        estadoDisponibilidad: this.estadoDisponibilidadCcDesde(totalPagado, factura.importe),
      },
    });
  }

  private estadoDisponibilidadCcDesde(pagado: number, importe: number): string {
    const EPS = 1e-6;
    if (pagado <= EPS) return 'pendiente';
    if (pagado + EPS >= importe) return 'cancelado';
    return 'parcial';
  }
}
