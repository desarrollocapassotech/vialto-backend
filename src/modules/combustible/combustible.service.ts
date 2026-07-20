import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { CloudinaryService } from "../../shared/storage/cloudinary.service";
import { KM_DELTA_PLAUSIBLE_MAX } from "../../shared/util/combustible-km.constants";

import { CreateCargaDto } from "./dto/create-carga.dto";
import { UpdateCargaDto } from "./dto/update-carga.dto";
import { CreateCargaChoferDto } from "./dto/create-carga-chofer.dto";
import { UpdateCargaChoferDto } from "./dto/update-carga-chofer.dto";

/** Datos mínimos de contexto de autenticación que el servicio necesita. */
interface CombustibleAuth {
  tenantId: string | null;
  userId: string;
  role: string | null;
}

/** Umbrales de outlier/semáforo — constantes ajustables a mano. */
const OUTLIER_PCT_CATEGORIA = 0.3; // +30% de litros sobre el promedio de su categoría (tipo de vehículo)
const SEMAFORO_AMARILLO_PCT = 0.15; // costo/km +15% sobre el promedio de su categoría
const SEMAFORO_ROJO_PCT = 0.5; // costo/km +50% sobre el promedio de su categoría

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
}

/**
 * Medianoche local (hora del server) del día `YYYY-MM-DD` — límite inferior de un rango.
 * OJO: `new Date("YYYY-MM-DD")` parsea como medianoche UTC, no local; construir a partir
 * de los componentes año/mes/día evita el corrimiento cuando el server no corre en UTC.
 */
function startOfDayLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Fin del día local (23:59:59.999) del día `YYYY-MM-DD` — límite superior de un rango. */
function endOfDayLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

type CargaHistorica = {
  id: string;
  vehiculoId: string | null;
  km: number;
  fecha: Date;
  litros: number;
  importe: number;
};

/** Una carga marcada `sospechoso` en el período — ver docs/combustible-correccion-cargas-historicas.md. */
type Alerta = {
  cargaId: string;
  vehiculoId: string | null;
  patente: string;
  choferNombre: string | null;
  fecha: string;
  motivoSospecha: string;
  litros: number;
  importe: number;
  precioPorLitro: number;
};

type PorVehiculoRow = {
  vehiculoId: string;
  patente: string;
  tipo: string;
  litros: number;
  monto: number;
  cantidad: number;
  kmRecorridos: number | null;
  costoPorKm: number | null;
  litrosPor100Km: number | null;
  esOutlier: boolean;
  semaforo: "verde" | "amarillo" | "rojo";
};

@Injectable()
export class CombustibleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async uploadFoto(
    tenantId: string,
    file: Express.Multer.File,
    tipo: "tacometro" | "ticket",
  ) {
    const url = await this.cloudinary.uploadCombustibleFoto(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }

  private assertCoherenciaImporte(
    litros: number,
    precioPorLitro: number,
    importe: number,
  ) {
    if (!litros || !precioPorLitro) {
      return; // Omitir validación si los litros o el precio son 0 o no están definidos
    }
    const expectedImporte = litros * precioPorLitro;
    const diff = Math.abs(importe - expectedImporte);
    const tolerance = expectedImporte * 0.01;

    if (diff > tolerance) {
      throw new BadRequestException(
        `El importe ingresado ($${importe.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) no coincide con el cálculo de litros x precio por litro ($${expectedImporte.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). La diferencia supera el 1% de tolerancia permitido.`,
      );
    }
  }

  async getLimitesKm(
    tenantId: string,
    vehiculoId: string,
    fecha: Date,
    excludeId?: string,
  ) {
    // 1. Validar límite inferior: Carga inmediatamente ANTERIOR a la fecha indicada
    const prev = await this.prisma.cargaCombustible.findFirst({
      where: {
        tenantId,
        vehiculoId,
        fecha: { lte: fecha }, // 'lte' incluye cargas registradas en el mismo día exacto
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
      select: { km: true, fecha: true },
    });

    // 2. Validar límite superior: Carga inmediatamente POSTERIOR a la fecha indicada (vital para cargas retroactivas)
    const next = await this.prisma.cargaCombustible.findFirst({
      where: {
        tenantId,
        vehiculoId,
        fecha: { gte: fecha },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [{ fecha: "asc" }, { createdAt: "asc" }],
      select: { km: true, fecha: true },
    });

    return { prev, next };
  }

  private async assertKmNoRetroceso(
    tenantId: string,
    vehiculoId: string,
    fecha: Date,
    km: number,
    excludeId?: string,
  ) {
    const { prev, next } = await this.getLimitesKm(tenantId, vehiculoId, fecha, excludeId);

    if (prev && km < prev.km) {
      const fechaFmt = new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(prev.fecha);
      throw new BadRequestException(
        `El kilometraje ingresado (${km} km) es inconsistente: no puede ser inferior al de la carga anterior registrada el ${fechaFmt} (${prev.km} km).`,
      );
    }

    if (next && km > next.km) {
      const fechaFmt = new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(next.fecha);
      throw new BadRequestException(
        `El kilometraje ingresado (${km} km) es inconsistente: no puede ser superior al de una carga posterior ya registrada el ${fechaFmt} (${next.km} km).`,
      );
    }
  }

  private async assertVehiculoChofer(
    tenantId: string,
    vehiculoId: string,
    choferId?: string | null,
  ) {
    const v = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, tenantId },
    });
    if (!v) throw new BadRequestException("Vehículo inválido");
    if (choferId) {
      const ch = await this.prisma.chofer.findFirst({
        where: { id: choferId, tenantId },
      });
      if (!ch) throw new BadRequestException("Chofer inválido");
    }
  }

  async findAll(
    auth: CombustibleAuth,
    vehiculoId?: string,
    choferId?: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 10,
    estacion?: string,
    formaPago?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(200, Math.max(1, limit));

    const where: Record<string, unknown> = { tenantId: auth.tenantId };

    if (auth.role === "member") {
      where["createdBy"] = auth.userId;
    }

    if (vehiculoId) where["vehiculoId"] = vehiculoId;
    if (choferId) where["choferId"] = choferId;
    if (estacion)
      where["estacion"] = { contains: estacion, mode: "insensitive" };
    if (formaPago) where["formaPago"] = formaPago;

    if (from || to) {
      const fechaWhere: Record<string, Date> = {};
      if (from) fechaWhere.gte = startOfDayLocal(from);
      if (to) fechaWhere.lte = endOfDayLocal(to);
      where["fecha"] = fechaWhere;
    }

    const [total, cargas] = await Promise.all([
      this.prisma.cargaCombustible.count({ where }),
      this.prisma.cargaCombustible.findMany({
        where,
        orderBy: { fecha: "desc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: {
          vehiculo: { select: { patente: true } },
          chofer: { select: { nombre: true } },
        },
      }),
    ]);

    return { cargas, total, page: safePage, limit: safeLimit };
  }

  /** Estaciones distintas entre las cargas existentes, para poblar el filtro del listado. */
  async getEstaciones(auth: CombustibleAuth): Promise<string[]> {
    const where: Record<string, unknown> = { tenantId: auth.tenantId };
    if (auth.role === "member") {
      where["createdBy"] = auth.userId;
    }
    const rows = await this.prisma.cargaCombustible.findMany({
      where,
      distinct: ["estacion"],
      select: { estacion: true },
      orderBy: { estacion: "asc" },
    });
    return rows.map((r) => r.estacion);
  }

  async findOne(id: string, auth: CombustibleAuth) {
    const where: Record<string, any> = { id };
    if (auth.role !== "superadmin") {
      where.tenantId = auth.tenantId;
    }
    const carga = await this.prisma.cargaCombustible.findFirst({
      where,
    });
    if (!carga) throw new NotFoundException("Carga no encontrada");
    if (auth.role === "member" && carga.createdBy !== auth.userId) {
      throw new ForbiddenException("No tenés acceso a esta carga");
    }
    return carga;
  }

  async create(dto: CreateCargaDto, auth: CombustibleAuth) {
    this.assertCoherenciaImporte(dto.litros, dto.precioPorLitro, dto.importe);
    await this.assertVehiculoChofer(
      auth.tenantId,
      dto.vehiculoId,
      dto.choferId,
    );
    const fechaCarga = dto.fecha ? new Date(dto.fecha) : new Date();
    await this.assertKmNoRetroceso(
      auth.tenantId,
      dto.vehiculoId,
      fechaCarga,
      dto.km,
    );
    const carga = await this.prisma.cargaCombustible.create({
      data: {
        tenantId: auth.tenantId,
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId ?? null,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago ?? null,
        fecha: fechaCarga,
        createdBy: auth.userId,
        fotoTacometro: dto.fotoTacometro ?? null,
        fotoTicket: dto.fotoTicket ?? null,
      },
    });
    await this.syncVehiculoKmActual(auth.tenantId as string, dto.vehiculoId);
    return carga;
  }

  /**
   * Sincroniza `Vehiculo.kmActual` con el km de su carga de combustible más
   * reciente (por fecha). La coherencia (km > carga anterior) ya se validó
   * antes de guardar vía `assertKmNoRetroceso` — acá solo se refleja el dato.
   * Si el vehículo no tiene cargas (ej. se eliminó la última), no se toca.
   */
  private async syncVehiculoKmActual(
    tenantId: string,
    vehiculoId: string | null | undefined,
  ) {
    if (!vehiculoId) return;
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: { tenantId, vehiculoId },
      orderBy: { fecha: "desc" },
      select: { km: true },
    });
    if (!ultima) return;
    await this.prisma.vehiculo.update({
      where: { id: vehiculoId },
      data: { kmActual: ultima.km },
    });
  }

  async update(id: string, dto: UpdateCargaDto, auth: CombustibleAuth) {
    const carga = await this.findOne(id, auth);
    const nextVehiculo = dto.vehiculoId ?? carga.vehiculoId ?? null;
    const nextChofer =
      dto.choferId === undefined ? carga.choferId : dto.choferId;
    if (nextVehiculo) {
      await this.assertVehiculoChofer(auth.tenantId, nextVehiculo, nextChofer);
    }

    if (auth.role === "member" && carga.createdBy !== auth.userId) {
      throw new ForbiddenException("No podés editar esta carga");
    }

    const nextKm = dto.km !== undefined ? dto.km : carga.km;
    const efectivaFecha = dto.fecha ? new Date(dto.fecha) : carga.fecha;
    if (nextVehiculo) {
      await this.assertKmNoRetroceso(
        auth.tenantId,
        nextVehiculo,
        efectivaFecha,
        nextKm,
        id,
      );
    }

    const nextLitros = dto.litros !== undefined ? dto.litros : carga.litros;
    const nextPrecio =
      dto.precioPorLitro !== undefined
        ? dto.precioPorLitro
        : carga.precioPorLitro;
    const nextImporte = dto.importe !== undefined ? dto.importe : carga.importe;
    this.assertCoherenciaImporte(nextLitros, nextPrecio, nextImporte);

    if (
      carga.fotoTacometro &&
      dto.fotoTacometro !== undefined &&
      dto.fotoTacometro !== carga.fotoTacometro
    ) {
      throw new BadRequestException(
        "La foto del tacómetro ya está guardada y no puede ser modificada",
      );
    }
    if (
      carga.fotoTicket &&
      dto.fotoTicket !== undefined &&
      dto.fotoTicket !== carga.fotoTicket
    ) {
      throw new BadRequestException(
        "La foto del ticket ya está guardada y no puede ser modificada",
      );
    }

    const actualizada = await this.prisma.cargaCombustible.update({
      where: { id },
      data: {
        vehiculoId: dto.vehiculoId,
        choferId: dto.choferId,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago,
        fecha:
          dto.fecha === undefined
            ? undefined
            : dto.fecha
              ? new Date(dto.fecha)
              : undefined,
        fotoTacometro: dto.fotoTacometro,
        fotoTicket: dto.fotoTicket,
      },
    });

    await this.syncVehiculoKmActual(auth.tenantId as string, nextVehiculo);
    if (carga.vehiculoId && carga.vehiculoId !== nextVehiculo) {
      // La carga se movió a otro vehículo: el anterior también puede haber
      // perdido su carga más reciente.
      await this.syncVehiculoKmActual(
        auth.tenantId as string,
        carga.vehiculoId,
      );
    }

    return actualizada;
  }

  async remove(id: string, auth: CombustibleAuth) {
    const carga = await this.findOne(id, auth);
    await this.prisma.cargaCombustible.delete({ where: { id } });
    await this.syncVehiculoKmActual(auth.tenantId as string, carga.vehiculoId);
    return { deleted: id };
  }

  async findAllByChofer(choferId: string, tenantId: string, month?: string) {
    const where: Record<string, unknown> = { tenantId, choferId };

    if (month) {
      const [year, mon] = month.split("-").map(Number);
      where["fecha"] = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    const cargas = await this.prisma.cargaCombustible.findMany({
      where,
      orderBy: { fecha: "desc" },
      take: 200,
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });

    return { cargas, count: cargas.length };
  }

  async createByChofer(
    dto: CreateCargaChoferDto,
    choferId: string,
    tenantId: string,
  ) {
    const patenteClean = dto.patente.replace(/\s+/g, "").toUpperCase();
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: {
        tenantId,
        patente: { equals: patenteClean, mode: "insensitive" },
      },
    });
    if (!vehiculo) {
      throw new BadRequestException(
        `No se encontró el vehículo con patente "${dto.patente}" en esta empresa`,
      );
    }
    const fechaCarga = dto.fecha ? new Date(dto.fecha) : new Date();
    await this.assertKmNoRetroceso(tenantId, vehiculo.id, fechaCarga, dto.km);
    this.assertCoherenciaImporte(dto.litros, dto.precioPorLitro, dto.importe);
    const carga = await this.prisma.cargaCombustible.create({
      data: {
        tenantId,
        vehiculoId: vehiculo.id,
        choferId,
        estacion: dto.estacion,
        litros: dto.litros,
        precioPorLitro: dto.precioPorLitro,
        importe: dto.importe,
        km: dto.km,
        formaPago: dto.formaPago ?? null,
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        createdBy: choferId,
        fotoTacometro: dto.fotoTacometro ?? null,
        fotoTicket: dto.fotoTicket ?? null,
      },
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });
    await this.syncVehiculoKmActual(tenantId, vehiculo.id);
    return carga;
  }

  async getUltimaCargaChofer(choferId: string, tenantId: string) {
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: { tenantId, choferId },
      orderBy: { fecha: "desc" },
      include: { vehiculo: { select: { patente: true } } },
    });
    if (!ultima) return null;
    return { patente: ultima.vehiculo?.patente ?? null };
  }

  async getUltimoKmPorPatente(
    patente: string,
    tenantId: string,
    excludeId?: string,
  ) {
    const patenteClean = patente.replace(/\s+/g, "").toUpperCase();
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: {
        tenantId,
        patente: { equals: patenteClean, mode: "insensitive" },
      },
    });
    if (!vehiculo) return null;
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: {
        tenantId,
        vehiculoId: vehiculo.id,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { fecha: "desc" },
      select: { km: true, fecha: true },
    });
    if (!ultima) return null;
    return { km: ultima.km, fecha: ultima.fecha.toISOString() };
  }

  async deleteByChofer(id: string, choferId: string, tenantId: string) {
    throw new ForbiddenException(
      "Los conductores no tienen permitido eliminar cargas",
    );
  }

  async updateByChofer(
    id: string,
    dto: UpdateCargaChoferDto,
    choferId: string,
    tenantId: string,
  ) {
    const carga = await this.prisma.cargaCombustible.findFirst({
      where: { id, tenantId },
    });
    if (!carga) throw new NotFoundException("Carga no encontrada");
    if (carga.choferId !== choferId) {
      throw new ForbiddenException("Solo podés editar tus propias cargas");
    }

    let vehiculoId: string | undefined = undefined;
    if (dto.patente !== undefined) {
      const patenteClean = dto.patente.replace(/\s+/g, "").toUpperCase();
      const vehiculo = await this.prisma.vehiculo.findFirst({
        where: {
          tenantId,
          patente: { equals: patenteClean, mode: "insensitive" },
        },
      });
      if (!vehiculo) {
        throw new BadRequestException(
          `No se encontró el vehículo con patente "${dto.patente}" en esta empresa`,
        );
      }
      vehiculoId = vehiculo.id;
    }

    const nextKm = dto.km !== undefined ? dto.km : carga.km;
    const efectivaFecha = dto.fecha ? new Date(dto.fecha) : carga.fecha;
    const efectivoVehiculoId = vehiculoId ?? carga.vehiculoId;
    if (efectivoVehiculoId) {
      await this.assertKmNoRetroceso(
        tenantId,
        efectivoVehiculoId,
        efectivaFecha,
        nextKm,
        id,
      );
    }

    const nextLitros = dto.litros !== undefined ? dto.litros : carga.litros;
    const nextPrecio =
      dto.precioPorLitro !== undefined
        ? dto.precioPorLitro
        : carga.precioPorLitro;
    const nextImporte = dto.importe !== undefined ? dto.importe : carga.importe;
    this.assertCoherenciaImporte(nextLitros, nextPrecio, nextImporte);

    if (
      carga.fotoTacometro &&
      dto.fotoTacometro !== undefined &&
      dto.fotoTacometro !== carga.fotoTacometro
    ) {
      throw new BadRequestException(
        "La foto del tacómetro ya está guardada y no puede ser modificada",
      );
    }
    if (
      carga.fotoTicket &&
      dto.fotoTicket !== undefined &&
      dto.fotoTicket !== carga.fotoTicket
    ) {
      throw new BadRequestException(
        "La foto del ticket ya está guardada y no puede ser modificada",
      );
    }

    const actualizada = await this.prisma.cargaCombustible.update({
      where: { id },
      data: {
        ...(vehiculoId !== undefined && { vehiculoId }),
        ...(dto.estacion !== undefined && { estacion: dto.estacion }),
        ...(dto.litros !== undefined && { litros: dto.litros }),
        ...(dto.precioPorLitro !== undefined && {
          precioPorLitro: dto.precioPorLitro,
        }),
        ...(dto.importe !== undefined && { importe: dto.importe }),
        ...(dto.km !== undefined && { km: dto.km }),
        ...(dto.formaPago !== undefined && { formaPago: dto.formaPago }),
        ...(dto.fecha !== undefined && { fecha: new Date(dto.fecha) }),
        ...(dto.fotoTacometro !== undefined && {
          fotoTacometro: dto.fotoTacometro,
        }),
        ...(dto.fotoTicket !== undefined && { fotoTicket: dto.fotoTicket }),
      },
      include: {
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true, dni: true } },
      },
    });

    await this.syncVehiculoKmActual(tenantId, efectivoVehiculoId);
    if (carga.vehiculoId && carga.vehiculoId !== efectivoVehiculoId) {
      await this.syncVehiculoKmActual(tenantId, carga.vehiculoId);
    }

    return actualizada;
  }

  async getDashboard(auth: CombustibleAuth, from?: string, to?: string) {
    const tenantId = auth.tenantId as string;
    const where: Record<string, unknown> = { tenantId };

    let fromDate: Date | null = null;
    let toDate: Date | null = null;
    if (from || to) {
      const fechaWhere: Record<string, Date> = {};
      if (from) {
        fromDate = startOfDayLocal(from);
        fechaWhere.gte = fromDate;
      }
      if (to) {
        toDate = endOfDayLocal(to);
        fechaWhere.lte = toDate;
      }
      where["fecha"] = fechaWhere;
    }

    const [todasCargas, ultimasCargas, tenant] = await Promise.all([
      this.prisma.cargaCombustible.findMany({
        where: { ...where, sospechoso: false },
        select: {
          id: true,
          litros: true,
          importe: true,
          vehiculoId: true,
          choferId: true,
          estacion: true,
          formaPago: true,
          fecha: true,
        },
      }),
      this.prisma.cargaCombustible.findMany({
        where,
        orderBy: { fecha: "desc" },
        take: 10,
        select: {
          id: true,
          fecha: true,
          litros: true,
          importe: true,
          km: true,
          estacion: true,
          formaPago: true,
          vehiculo: { select: { patente: true } },
          chofer: { select: { nombre: true } },
        },
      }),
      this.prisma.tenant.findUnique({
        where: { clerkOrgId: tenantId },
        select: { modules: true },
      }),
    ]);

    const totalCargas = todasCargas.length;
    const totalLitros = todasCargas.reduce((s, c) => s + c.litros, 0);
    const totalImporte = todasCargas.reduce((s, c) => s + c.importe, 0);
    const precioPorLitro = totalLitros > 0 ? totalImporte / totalLitros : 0;
    const litrosPorCarga = totalCargas > 0 ? totalLitros / totalCargas : 0;

    const costoTotalPeriodo = await this.buildCostoTotalPeriodo(
      tenantId,
      totalImporte,
      fromDate,
      toDate,
    );

    const distribucionEstaciones = this.buildDistribucion(
      todasCargas,
      (c) => c.estacion,
    );
    const distribucionFormaPago = this.buildDistribucion(
      todasCargas,
      (c) => c.formaPago ?? "sin_especificar",
    );

    const vehiculoIds = Array.from(
      new Set(
        todasCargas.map((c) => c.vehiculoId).filter((v): v is string => !!v),
      ),
    );
    const choferIds = Array.from(
      new Set(
        todasCargas.map((c) => c.choferId).filter((v): v is string => !!v),
      ),
    );

    const [vehiculos, historicas, choferes, alertas] = await Promise.all([
      vehiculoIds.length > 0
        ? this.prisma.vehiculo.findMany({
            where: { id: { in: vehiculoIds } },
            select: { id: true, patente: true, tipo: true },
          })
        : Promise.resolve([]),
      vehiculoIds.length > 0
        ? this.prisma.cargaCombustible.findMany({
            where: {
              tenantId,
              vehiculoId: { in: vehiculoIds },
              sospechoso: false,
            },
            orderBy: [{ vehiculoId: "asc" }, { fecha: "asc" }],
            select: {
              id: true,
              vehiculoId: true,
              km: true,
              fecha: true,
              litros: true,
              importe: true,
            },
          })
        : Promise.resolve([]),
      choferIds.length > 0
        ? this.prisma.chofer.findMany({
            where: { id: { in: choferIds } },
            select: { id: true, nombre: true },
          })
        : Promise.resolve([]),
      this.buildAlertasSospechosas(where),
    ]);

    const vehiculoMap = new Map(vehiculos.map((v) => [v.id, v]));
    const choferNombreMap = new Map(choferes.map((c) => [c.id, c.nombre]));

    const kmPeriodoPorVehiculo = this.buildKmPeriodoPorVehiculo(
      historicas,
      fromDate,
      toDate,
    );

    const porVehiculo = this.buildPorVehiculo(
      todasCargas,
      vehiculoMap,
      kmPeriodoPorVehiculo,
      alertas,
    );

    const porChofer = this.buildPorChofer(todasCargas, choferNombreMap);

    const evolucionPrecio = this.buildEvolucionPrecio(
      todasCargas,
      fromDate,
      toDate,
    );
    const evolucionCostoPorKm = this.buildEvolucionCostoPorKm(
      historicas,
      fromDate,
      toDate,
    );

    const modules = (tenant?.modules ?? []).map((m) => m.toLowerCase());
    const viajesCruce =
      modules.includes("viajes") && fromDate && toDate
        ? await this.getViajesCruce(tenantId, porVehiculo, fromDate, toDate)
        : null;

    return {
      totalCargas,
      totalLitros,
      totalImporte,
      precioPorLitro,
      litrosPorCarga,
      costoTotalPeriodo,
      distribucionEstaciones,
      distribucionFormaPago,
      porVehiculo,
      porChofer,
      alertas: alertas
        .slice()
        .sort(
          (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
        )
        .slice(0, 50),
      evolucionPrecio,
      evolucionCostoPorKm,
      viajesCruce,
      ultimasCargas,
    };
  }

  /** Costo total del período vs. el período inmediatamente anterior de igual duración. */
  private async buildCostoTotalPeriodo(
    tenantId: string,
    totalImporte: number,
    fromDate: Date | null,
    toDate: Date | null,
  ): Promise<{
    current: number;
    previous: number;
    changePct: number | null;
  } | null> {
    if (!fromDate || !toDate) return null;
    const spanMs = toDate.getTime() - fromDate.getTime();
    const prevTo = fromDate;
    const prevFrom = new Date(fromDate.getTime() - spanMs);
    const prevAgg = await this.prisma.cargaCombustible.aggregate({
      where: {
        tenantId,
        fecha: { gte: prevFrom, lt: prevTo },
        sospechoso: false,
      },
      _sum: { importe: true },
    });
    const previous = roundMoney(prevAgg._sum.importe ?? 0);
    const current = roundMoney(totalImporte);
    if (previous === 0) {
      return { current, previous, changePct: current === 0 ? 0 : null };
    }
    return {
      current,
      previous,
      changePct: Math.round(((current - previous) / previous) * 1000) / 10,
    };
  }

  /** Agrupa cargas por la clave dada, sumando litros/importe y contando cargas. Orden desc por monto. */
  private buildDistribucion<T extends { litros: number; importe: number }>(
    cargas: T[],
    keyOf: (c: T) => string,
  ): Array<{
    clave: string;
    litros: number;
    monto: number;
    cantidad: number;
    precioPromedio: number;
  }> {
    const map = new Map<
      string,
      { litros: number; monto: number; cantidad: number }
    >();
    for (const c of cargas) {
      const key = keyOf(c);
      const acc = map.get(key) ?? { litros: 0, monto: 0, cantidad: 0 };
      acc.litros += c.litros;
      acc.monto += c.importe;
      acc.cantidad += 1;
      map.set(key, acc);
    }
    return Array.from(map.entries())
      .map(([clave, acc]) => ({
        clave,
        litros: roundMoney(acc.litros),
        monto: roundMoney(acc.monto),
        cantidad: acc.cantidad,
        precioPromedio: acc.litros > 0 ? roundMoney(acc.monto / acc.litros) : 0,
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  /**
   * Recorre el histórico completo (no solo el período) de cada vehículo, en orden
   * cronológico, para acumular el km recorrido entre cargas consecutivas cuya carga
   * posterior cae en el período (usado para costo/km y L/100km en "Por vehículo").
   */
  private buildKmPeriodoPorVehiculo(
    historicas: CargaHistorica[],
    fromDate: Date | null,
    toDate: Date | null,
  ): Map<string, number> {
    function enPeriodo(fecha: Date): boolean {
      if (fromDate && fecha < fromDate) return false;
      if (toDate && fecha > toDate) return false;
      return true;
    }

    const porVehiculo = this.groupHistoricasPorVehiculo(historicas);
    const kmPeriodoPorVehiculo = new Map<string, number>();

    for (const [vehiculoId, lista] of porVehiculo) {
      let kmPeriodo = 0;

      for (let i = 1; i < lista.length; i++) {
        const actual = lista[i];
        if (!enPeriodo(actual.fecha)) continue;

        const anterior = lista[i - 1];
        const delta = actual.km - anterior.km;
        // Delta implausible (> KM_DELTA_PLAUSIBLE_MAX) → no se suma. Suele pasar cuando
        // el vecino "anterior" en esta cadena filtrada por sospechoso=false queda lejos
        // en el tiempo (varias cargas intermedias excluidas): el km real recorrido en ese
        // hueco no es atribuible de forma confiable a esta carga puntual, y sumarlo igual
        // infla el denominador de costo/km sin que el gasto de esas cargas excluidas
        // aparezca en el numerador.
        if (delta > 0 && delta <= KM_DELTA_PLAUSIBLE_MAX) kmPeriodo += delta;
      }

      kmPeriodoPorVehiculo.set(vehiculoId, kmPeriodo);
    }

    return kmPeriodoPorVehiculo;
  }

  /** Cargas del período marcadas `sospechoso` — la fuente de "Alertas" en el dashboard. */
  private async buildAlertasSospechosas(
    where: Record<string, unknown>,
  ): Promise<Alerta[]> {
    const cargas = await this.prisma.cargaCombustible.findMany({
      where: { ...where, sospechoso: true },
      orderBy: { fecha: "desc" },
      select: {
        id: true,
        vehiculoId: true,
        fecha: true,
        litros: true,
        importe: true,
        motivoSospecha: true,
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true } },
      },
    });

    return cargas.map((c) => ({
      cargaId: c.id,
      vehiculoId: c.vehiculoId,
      patente: c.vehiculo?.patente ?? c.vehiculoId ?? "—",
      choferNombre: c.chofer?.nombre ?? null,
      fecha: c.fecha.toISOString(),
      motivoSospecha: c.motivoSospecha ?? "sin_especificar",
      litros: c.litros,
      importe: c.importe,
      precioPorLitro: c.litros > 0 ? roundMoney(c.importe / c.litros) : 0,
    }));
  }

  /** Ranking por vehículo (litros/monto/cantidad del período + eficiencia + outlier + semáforo). */
  private buildPorVehiculo(
    todasCargas: Array<{
      vehiculoId: string | null;
      litros: number;
      importe: number;
    }>,
    vehiculoMap: Map<string, { patente: string; tipo: string }>,
    kmPeriodoPorVehiculo: Map<string, number>,
    alertas: Alerta[],
  ): PorVehiculoRow[] {
    const agg = new Map<
      string,
      { litros: number; monto: number; cantidad: number }
    >();
    for (const c of todasCargas) {
      if (!c.vehiculoId) continue;
      const acc = agg.get(c.vehiculoId) ?? { litros: 0, monto: 0, cantidad: 0 };
      acc.litros += c.litros;
      acc.monto += c.importe;
      acc.cantidad += 1;
      agg.set(c.vehiculoId, acc);
    }

    const filasBase = Array.from(agg.entries()).map(([vehiculoId, acc]) => {
      const v = vehiculoMap.get(vehiculoId);
      const kmPeriodo = kmPeriodoPorVehiculo.get(vehiculoId) ?? 0;
      const kmRecorridos = kmPeriodo > 0 ? kmPeriodo : null;
      const litros = roundMoney(acc.litros);
      const monto = roundMoney(acc.monto);
      return {
        vehiculoId,
        patente: v?.patente ?? vehiculoId,
        tipo: v?.tipo ?? "otro",
        litros,
        monto,
        cantidad: acc.cantidad,
        kmRecorridos,
        costoPorKm: kmRecorridos ? roundMoney(monto / kmRecorridos) : null,
        litrosPor100Km: kmRecorridos
          ? roundMoney((litros / kmRecorridos) * 100)
          : null,
      };
    });

    const litrosPorTipo = new Map<string, number[]>();
    const costoKmPorTipo = new Map<string, number[]>();
    for (const f of filasBase) {
      const litrosArr = litrosPorTipo.get(f.tipo) ?? [];
      litrosArr.push(f.litros);
      litrosPorTipo.set(f.tipo, litrosArr);
      if (f.costoPorKm != null) {
        const costoArr = costoKmPorTipo.get(f.tipo) ?? [];
        costoArr.push(f.costoPorKm);
        costoKmPorTipo.set(f.tipo, costoArr);
      }
    }

    const alertaVehiculoIds = new Set(alertas.map((a) => a.vehiculoId));

    const porVehiculo: PorVehiculoRow[] = filasBase
      .map((f) => {
        const litrosGrupo = litrosPorTipo.get(f.tipo) ?? [];
        const promedioLitrosCategoria =
          litrosGrupo.length > 1 ? avg(litrosGrupo) : 0;
        const esOutlier =
          promedioLitrosCategoria > 0 &&
          f.litros > promedioLitrosCategoria * (1 + OUTLIER_PCT_CATEGORIA);

        const costoKmGrupo = costoKmPorTipo.get(f.tipo) ?? [];
        const promedioCostoKmCategoria =
          costoKmGrupo.length > 1 ? avg(costoKmGrupo) : 0;

        let semaforo: "verde" | "amarillo" | "rojo" = "verde";
        if (alertaVehiculoIds.has(f.vehiculoId)) {
          semaforo = "rojo";
        } else if (promedioCostoKmCategoria > 0 && f.costoPorKm != null) {
          if (f.costoPorKm > promedioCostoKmCategoria * (1 + SEMAFORO_ROJO_PCT))
            semaforo = "rojo";
          else if (
            f.costoPorKm >
            promedioCostoKmCategoria * (1 + SEMAFORO_AMARILLO_PCT)
          )
            semaforo = "amarillo";
        }

        return { ...f, esOutlier, semaforo };
      })
      .sort((a, b) => b.monto - a.monto);

    return porVehiculo;
  }

  /** Ranking por chofer (litros/monto/cantidad del período). Sin chofer asignado se agrupa aparte. */
  private buildPorChofer(
    todasCargas: Array<{
      choferId: string | null;
      litros: number;
      importe: number;
    }>,
    choferNombreMap: Map<string, string>,
  ): Array<{
    choferId: string | null;
    nombre: string;
    litros: number;
    monto: number;
    cantidad: number;
  }> {
    const SIN_CHOFER = "__sin_chofer__";
    const agg = new Map<
      string,
      { litros: number; monto: number; cantidad: number }
    >();
    for (const c of todasCargas) {
      const key = c.choferId ?? SIN_CHOFER;
      const acc = agg.get(key) ?? { litros: 0, monto: 0, cantidad: 0 };
      acc.litros += c.litros;
      acc.monto += c.importe;
      acc.cantidad += 1;
      agg.set(key, acc);
    }
    return Array.from(agg.entries())
      .map(([key, acc]) => ({
        choferId: key === SIN_CHOFER ? null : key,
        nombre:
          key === SIN_CHOFER
            ? "Sin chofer asignado"
            : (choferNombreMap.get(key) ?? key),
        litros: roundMoney(acc.litros),
        monto: roundMoney(acc.monto),
        cantidad: acc.cantidad,
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  /** Agrupa el histórico de cargas por vehículo, preservando el orden cronológico ya dado por la query. */
  private groupHistoricasPorVehiculo(
    historicas: CargaHistorica[],
  ): Map<string, CargaHistorica[]> {
    const map = new Map<string, CargaHistorica[]>();
    for (const h of historicas) {
      if (!h.vehiculoId) continue;
      const arr = map.get(h.vehiculoId) ?? [];
      arr.push(h);
      map.set(h.vehiculoId, arr);
    }
    return map;
  }

  /** Decide el tamaño de bucket (día/semana/mes) según el largo del rango, para cualquier serie temporal del dashboard. */
  private resolveBucketPlan(
    fromDate: Date | null,
    toDate: Date | null,
    fallbackFechasMs: number[],
  ): { desde: Date; bucketDias: number } | null {
    if (!fromDate && !toDate && fallbackFechasMs.length === 0) return null;
    const desde = fromDate ?? new Date(Math.min(...fallbackFechasMs));
    const hasta = toDate ?? new Date(Math.max(...fallbackFechasMs));
    const rangoDias = Math.max(
      1,
      Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000),
    );
    const bucketDias = rangoDias <= 31 ? 1 : rangoDias <= 120 ? 7 : 30;
    return { desde, bucketDias };
  }

  private formatBucketLabel(
    desde: Date,
    hasta: Date,
    bucketDias: number,
  ): string {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(d);
    return bucketDias === 1 ? fmt(desde) : `${fmt(desde)}–${fmt(hasta)}`;
  }

  /** Bucketiza las cargas del período por día (≤31 días), semana (≤120) o mes, para ver la evolución del precio pagado. */
  private buildEvolucionPrecio(
    cargas: Array<{ litros: number; importe: number; fecha: Date }>,
    fromDate: Date | null,
    toDate: Date | null,
  ): Array<{
    etiqueta: string;
    desde: string;
    hasta: string;
    precioPromedio: number;
  }> {
    if (cargas.length === 0) return [];
    const plan = this.resolveBucketPlan(
      fromDate,
      toDate,
      cargas.map((c) => c.fecha.getTime()),
    );
    if (!plan) return [];
    const { desde, bucketDias } = plan;

    const buckets = new Map<
      number,
      { litros: number; monto: number; desde: Date; hasta: Date }
    >();
    for (const c of cargas) {
      const offset = Math.floor(
        (c.fecha.getTime() - desde.getTime()) / (86_400_000 * bucketDias),
      );
      const bucketInicio = new Date(
        desde.getTime() + offset * bucketDias * 86_400_000,
      );
      const bucketFin = new Date(
        bucketInicio.getTime() + bucketDias * 86_400_000 - 1,
      );
      const acc = buckets.get(offset) ?? {
        litros: 0,
        monto: 0,
        desde: bucketInicio,
        hasta: bucketFin,
      };
      acc.litros += c.litros;
      acc.monto += c.importe;
      buckets.set(offset, acc);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([, acc]) => ({
        etiqueta: this.formatBucketLabel(acc.desde, acc.hasta, bucketDias),
        desde: acc.desde.toISOString(),
        hasta: acc.hasta.toISOString(),
        precioPromedio: acc.litros > 0 ? roundMoney(acc.monto / acc.litros) : 0,
      }));
  }

  /**
   * Bucketiza el costo por km recorrido en el tiempo: por cada carga del período, atribuye su
   * importe y el km recorrido desde la carga anterior del mismo vehículo (mismo criterio que
   * `porVehiculo`) al bucket de la fecha de esa carga.
   */
  private buildEvolucionCostoPorKm(
    historicas: CargaHistorica[],
    fromDate: Date | null,
    toDate: Date | null,
  ): Array<{
    etiqueta: string;
    desde: string;
    hasta: string;
    costoPorKm: number;
  }> {
    function enPeriodo(fecha: Date): boolean {
      if (fromDate && fecha < fromDate) return false;
      if (toDate && fecha > toDate) return false;
      return true;
    }

    const fechasEnPeriodo = historicas
      .filter((h) => enPeriodo(h.fecha))
      .map((h) => h.fecha.getTime());
    const plan = this.resolveBucketPlan(fromDate, toDate, fechasEnPeriodo);
    if (!plan) return [];
    const { desde, bucketDias } = plan;

    const buckets = new Map<
      number,
      { km: number; monto: number; desde: Date; hasta: Date }
    >();
    function addToBucket(fecha: Date, km: number, monto: number) {
      const offset = Math.floor(
        (fecha.getTime() - desde.getTime()) / (86_400_000 * bucketDias),
      );
      const bucketInicio = new Date(
        desde.getTime() + offset * bucketDias * 86_400_000,
      );
      const bucketFin = new Date(
        bucketInicio.getTime() + bucketDias * 86_400_000 - 1,
      );
      const acc = buckets.get(offset) ?? {
        km: 0,
        monto: 0,
        desde: bucketInicio,
        hasta: bucketFin,
      };
      acc.km += km;
      acc.monto += monto;
      buckets.set(offset, acc);
    }

    const porVehiculo = this.groupHistoricasPorVehiculo(historicas);
    for (const [, lista] of porVehiculo) {
      for (let i = 0; i < lista.length; i++) {
        const actual = lista[i];
        if (!enPeriodo(actual.fecha)) continue;
        let kmDelta = 0;
        if (i > 0) {
          const delta = actual.km - lista[i - 1].km;
          // Ver nota en buildAlertasYKmPeriodo: delta implausible → no se cuenta, en vez
          // de inflar el km del bucket con un hueco de cargas excluidas.
          if (delta > 0 && delta <= KM_DELTA_PLAUSIBLE_MAX) kmDelta = delta;
        }
        addToBucket(actual.fecha, kmDelta, actual.importe);
      }
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([, acc]) => ({
        etiqueta: this.formatBucketLabel(acc.desde, acc.hasta, bucketDias),
        desde: acc.desde.toISOString(),
        hasta: acc.hasta.toISOString(),
        costoPorKm: acc.km > 0 ? roundMoney(acc.monto / acc.km) : 0,
      }));
  }

  /**
   * Cruce simplificado con Viajes: litros cargados del período vs. km facturados de los viajes
   * en los que participó el vehículo (vía la tabla puente ViajeVehiculo, sin prorratear entre
   * varios vehículos de un mismo viaje). Solo se llama si el tenant tiene `viajes` contratado.
   */
  private async getViajesCruce(
    tenantId: string,
    porVehiculo: PorVehiculoRow[],
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      vehiculoId: string;
      patente: string;
      litrosPeriodo: number;
      kmFacturadosPeriodo: number | null;
      litrosPor100KmFacturado: number | null;
    }>
  > {
    const vehiculoIds = porVehiculo.map((f) => f.vehiculoId);
    if (vehiculoIds.length === 0) return [];

    const vinculos = await this.prisma.viajeVehiculo.findMany({
      where: {
        tenantId,
        vehiculoId: { in: vehiculoIds },
        viaje: {
          OR: [
            { fechaCarga: { gte: from, lte: to } },
            { fechaCarga: null, fechaFinalizado: { gte: from, lte: to } },
            {
              fechaCarga: null,
              fechaFinalizado: null,
              createdAt: { gte: from, lte: to },
            },
          ],
        },
      },
      select: { vehiculoId: true, viaje: { select: { kmRecorridos: true } } },
    });

    const kmPorVehiculo = new Map<string, number>();
    for (const v of vinculos) {
      const km = v.viaje.kmRecorridos ?? 0;
      kmPorVehiculo.set(
        v.vehiculoId,
        (kmPorVehiculo.get(v.vehiculoId) ?? 0) + km,
      );
    }

    return porVehiculo
      .map((f) => {
        const km = kmPorVehiculo.get(f.vehiculoId) ?? 0;
        const kmFacturadosPeriodo = km > 0 ? km : null;
        return {
          vehiculoId: f.vehiculoId,
          patente: f.patente,
          litrosPeriodo: f.litros,
          kmFacturadosPeriodo,
          litrosPor100KmFacturado: kmFacturadosPeriodo
            ? roundMoney((f.litros / kmFacturadosPeriodo) * 100)
            : null,
        };
      })
      .sort((a, b) => b.litrosPeriodo - a.litrosPeriodo);
  }

  /** Cargas completas del rango (con patente/chofer) para exportar a Excel. Sin paginar, capado a 5000 filas. */
  async getCargasParaExport(auth: CombustibleAuth, from?: string, to?: string) {
    const where: Record<string, unknown> = { tenantId: auth.tenantId };
    if (from || to) {
      const fechaWhere: Record<string, Date> = {};
      if (from) fechaWhere.gte = startOfDayLocal(from);
      if (to) fechaWhere.lte = endOfDayLocal(to);
      where["fecha"] = fechaWhere;
    }

    const cargas = await this.prisma.cargaCombustible.findMany({
      where,
      orderBy: { fecha: "desc" },
      take: 5000,
      select: {
        id: true,
        fecha: true,
        estacion: true,
        litros: true,
        precioPorLitro: true,
        importe: true,
        km: true,
        formaPago: true,
        vehiculo: { select: { patente: true } },
        chofer: { select: { nombre: true } },
      },
    });

    return { cargas, total: cargas.length };
  }

  async getStats(auth: CombustibleAuth, month?: string) {
    const where: Record<string, unknown> = {
      tenantId: auth.tenantId,
      sospechoso: false,
    };

    if (month) {
      const [year, mon] = month.split("-").map(Number);
      where["fecha"] = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    const cargas = await this.prisma.cargaCombustible.findMany({ where });

    const stats = {
      totalCargas: cargas.length,
      totalLitros: cargas.reduce((s, c) => s + c.litros, 0),
      totalImporte: cargas.reduce((s, c) => s + c.importe, 0),
      totalKm: cargas.reduce((s, c) => s + c.km, 0),
      porEstacion: {} as Record<string, number>,
      porFormaPago: {} as Record<string, number>,
    };

    for (const c of cargas) {
      stats.porEstacion[c.estacion] = (stats.porEstacion[c.estacion] ?? 0) + 1;
      if (c.formaPago) {
        stats.porFormaPago[c.formaPago] =
          (stats.porFormaPago[c.formaPago] ?? 0) + 1;
      }
    }

    return stats;
  }
}
