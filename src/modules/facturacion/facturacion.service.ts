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
import { CreatePagoDto } from "./dto/create-pago.dto";
import { FacturasPaginatedQueryDto } from "./dto/facturas-paginated-query.dto";
import {
  computeEstadoFacturaLectura,
  importeOperativoFactura,
} from "./factura-estado-lectura";
import { syncFacturacionEstadoViajes } from "../viajes/viaje-estado-financiero";
import { attachAnuladoPorNombres } from "../../shared/util/anulado-por-nombre.util";
import { ClerkVialtoRoleService } from "../../core/auth/clerk-vialto-role.service";

type ViajeSnap = {
  id: string;
  facturacionEstado: string;
  monto: number | null;
  monedaMonto: string;
};

@Injectable()
export class FacturacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly clerkUsers: ClerkVialtoRoleService,
  ) {}

  private computeImporte(viajes: { monto: number | null }[]): number {
    return viajes.reduce((sum, v) => sum + (v.monto ?? 0), 0);
  }

  private async tieneArca(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    return tenant?.modules.includes("integracion-arca") ?? false;
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
      createdAt: Date;
      viajes: ViajeSnap[];
      pagos?: { importe: number }[];
    },
    tieneArca: boolean,
  ) {
    const { viajes, pagos = [], ...f } = row;
    const importe = importeOperativoFactura(f.importe, viajes);
    const { estado, cobrado, vencida } = computeEstadoFacturaLectura({
      viajes,
      fechaVencimiento: f.fechaVencimiento,
      importeGuardado: f.importe,
      pagos,
      arcaEstado: f.arcaEstado,
      tieneArca,
    });
    return {
      ...f,
      viajeIds: viajes.map((v) => v.id),
      importe,
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
    const [withNombre] = await attachAnuladoPorNombres(this.clerkUsers, [
      this.toShape(row, tieneArca),
    ]);
    return withNombre;
  }

  private async shapeManyConNombre(
    rows: Parameters<FacturacionService["toShape"]>[0][],
    tieneArca: boolean,
  ) {
    return attachAnuladoPorNombres(
      this.clerkUsers,
      rows.map((r) => this.toShape(r, tieneArca)),
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
  ): Promise<ViajeSnap[]> {
    if (viajeIds.length === 0) return [];
    const rows = await this.prisma.viaje.findMany({
      where: { id: { in: viajeIds }, tenantId },
      select: { id: true, facturacionEstado: true, monto: true, monedaMonto: true },
    });
    if (rows.length !== viajeIds.length) {
      throw new BadRequestException(
        "Uno o más viajes inválidos para este tenant",
      );
    }
    return rows;
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
  } as const;
  private readonly PAGO_SELECT = { importe: true } as const;

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
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
      take: 200,
    });
    return this.shapeManyConNombre(rows, tieneArca);
  }

  async findAllPaginated(tenantId: string, query: FacturasPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildFacturasWhere(tenantId, query);
    const tieneArca = await this.tieneArca(tenantId);
    const include = {
      viajes: { select: this.VIAJE_SELECT },
      pagos: { select: this.PAGO_SELECT },
    } as const;

    if (query.estado) {
      const rows = await this.prisma.factura.findMany({
        where,
        orderBy: { fechaEmision: "desc" },
        include,
      });
      const filtered = rows.map((r) => this.toShape(r, tieneArca)).filter((f) => {
        if (query.estado === "cobrado") return f.cobrado;
        if (query.estado === "vencida") return f.vencida;
        return f.estado === query.estado;
      });
      const total = filtered.length;
      const items = await attachAnuladoPorNombres(
        this.clerkUsers,
        filtered.slice((page - 1) * pageSize, page * pageSize),
      );
      return { items, meta: this.paginatedMeta(page, pageSize, total) };
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
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
    });
    if (!row) throw new NotFoundException("Factura no encontrada");
    const tieneArca = await this.tieneArca(tenantId);
    return this.shapeConNombre(row, tieneArca);
  }

  async createFactura(tenantId: string, dto: CreateFacturaDto) {
    await this.assertClienteCtx(tenantId, dto.clienteId);
    await this.assertTransportistaCtx(tenantId, dto.transportistaId);

    // Validación previa para atrapar el 99% de los casos antes de abrir transacción
    await this.assertNumeroFacturaUnico(tenantId, dto.numero);

    const viajeIds = dto.viajeIds ?? [];
    const viajes = await this.resolveViajes(tenantId, viajeIds);
    const moneda = this.assertMonedaUnica(viajes);
    const importe = this.computeImporte(viajes);
    const tieneArca = await this.tieneArca(tenantId);

    try {
      // Retornamos el resultado de la transacción esperando su resolución con 'await'
      return await this.prisma.$transaction(async (tx) => {
        const factura = await tx.factura.create({
          data: {
            tenantId,
            numero: dto.numero,
            tipo: dto.tipo,
            clienteId: dto.clienteId ?? null,
            transportistaId: dto.transportistaId ?? null,
            importe,
            moneda,
            fechaEmision: new Date(dto.fechaEmision),
            fechaVencimiento: dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null,
            estado: "pendiente",
            diferencia: dto.diferencia ?? null,
            ivaPct: dto.ivaPct ?? 21,
            comprobanteUrl: dto.comprobanteUrl ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        });

        if (viajeIds.length > 0) {
          // Vincular viajes y guardar nro de factura
          await tx.viaje.updateMany({
            where: { id: { in: viajeIds }, tenantId },
            data: { facturaId: factura.id },
          });
          await syncFacturacionEstadoViajes(tx, tenantId, viajeIds);
        }

        const updated = await tx.factura.findFirst({
          where: { id: factura.id },
          include: {
            viajes: { select: this.VIAJE_SELECT },
            pagos: { select: this.PAGO_SELECT },
          },
        });

        return this.toShape(updated!, tieneArca);
      });
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
    await this.findFactura(id, tenantId);
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
      // Actualizar campos de la factura
      const facturaActualizada = await tx.factura.update({
        where: { id },
        data: {
          ...(dto.numero !== undefined ? { numero: dto.numero } : {}),
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
          await syncFacturacionEstadoViajes(tx, tenantId, idsDesvinculados);
        }

        if (newIds.length > 0) {
          await tx.viaje.updateMany({
            where: { id: { in: newIds }, tenantId },
            data: { facturaId: id },
          });
          await syncFacturacionEstadoViajes(tx, tenantId, newIds);
        }
      }

      // Recalcular importe y moneda desde los viajes vinculados
      const viajes = await tx.viaje.findMany({
        where: { facturaId: id, tenantId },
        select: this.VIAJE_SELECT,
      });
      const importe = this.computeImporte(viajes);
      const updated = await tx.factura.update({
        where: { id },
        data: {
          importe,
          ...(monedaNueva !== undefined ? { moneda: monedaNueva } : {}),
        },
        include: {
          viajes: { select: this.VIAJE_SELECT },
          pagos: { select: this.PAGO_SELECT },
        },
      });
      return this.toShape(updated, tieneArca);
    });
  }

  async removeFactura(id: string, tenantId: string) {
    const viajesAfectados = await this.prisma.viaje.findMany({
      where: { facturaId: id, tenantId },
      select: { id: true },
    });
    const viajeIds = viajesAfectados.map((v) => v.id);

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.updateMany({
        where: { facturaId: id, tenantId },
        data: { facturaId: null },
      });
      await syncFacturacionEstadoViajes(tx, tenantId, viajeIds);
      return tx.factura.delete({ where: { id } });
    });
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
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
    });
    if (!factura) throw new NotFoundException("Factura no encontrada");
    const tieneArca = await this.tieneArca(tenantId);

    const importeOperativo = importeOperativoFactura(
      factura.importe,
      factura.viajes,
    );
    const totalPagado = factura.pagos.reduce((s, p) => s + p.importe, 0);
    const saldo = Math.round((importeOperativo - totalPagado) * 100) / 100;

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
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
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

  /** Alinea estado de viajes vinculados con cobro total o parcial de la factura. */
  private async syncViajesEstadoTrasPago(
    facturaId: string,
    tenantId: string,
  ): Promise<void> {
    const factura = await this.prisma.factura.findFirst({
      where: { id: facturaId, tenantId },
      include: {
        viajes: { select: this.VIAJE_SELECT },
        pagos: { select: this.PAGO_SELECT },
      },
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
    });

    await syncFacturacionEstadoViajes(
      this.prisma,
      tenantId,
      factura.viajes.map((v) => v.id),
      { cobrado },
    );
  }
}
