import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { OdometroService } from '../../../core/odometro/odometro.service';
import { OrdenesService } from '../ordenes.service';
import { TalleresService } from '../talleres.service';
import { ORIGEN_CHOFER } from '../ordenes.util';
import { TAREAS_MANTENIMIENTO_GRUPOS } from '../tareas-mantenimiento.const';
import { RegistrarServiceChoferDto } from './registrar-service-chofer.dto';

/**
 * El chofer registra un service del vehículo que tiene asignado, desde la app de Combustible.
 * Todo sale del token (tenantId + choferId): el vehículo nunca viene del request. La OT queda
 * como cualquier otra (cerrada, preventiva) con `origen = reporte_chofer`.
 */
@Injectable()
export class ChoferMantenimientoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odometro: OdometroService,
    private readonly ordenes: OrdenesService,
    private readonly talleres: TalleresService,
  ) {}

  private async tenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true, mantenimientoPlanesHabilitados: true },
    });
    return {
      habilitado: (t?.modules ?? []).some((m) => m.toLowerCase() === 'mantenimiento'),
      conPlanes: t?.mantenimientoPlanesHabilitados !== false,
    };
  }

  private async vehiculoAsignado(tenantId: string, choferId: string) {
    const a = await this.prisma.asignacionVehiculo.findFirst({
      where: { tenantId, choferId, fechaHasta: null, vehiculo: { tenantId, activo: true } },
      orderBy: { fechaDesde: 'desc' },
      select: { vehiculo: { select: { id: true, patente: true } } },
    });
    return a?.vehiculo ?? null;
  }

  private planesDelVehiculo(tenantId: string, vehiculoId: string) {
    return this.prisma.vehiculoPlan.findMany({
      where: { tenantId, vehiculoId, activo: true, plan: { tenantId, activo: true } },
      select: { id: true, plan: { select: { nombre: true, tareas: true } } },
      orderBy: { plan: { nombre: 'asc' } },
    });
  }

  /** Taller elegido de la lista o escrito a mano: si ya existe con ese nombre se usa, si no se crea. */
  private async resolverTaller(tenantId: string, dto: RegistrarServiceChoferDto): Promise<string | null> {
    if (dto.tallerId) return dto.tallerId; // `create` valida que sea de la empresa
    if (!dto.tallerNombre) return null;
    const buscar = () =>
      this.prisma.taller.findFirst({
        where: { tenantId, nombre: { equals: dto.tallerNombre, mode: 'insensitive' } },
        select: { id: true },
      });
    const existente = await buscar();
    if (existente) return existente.id;
    try {
      return (await this.talleres.create(tenantId, { nombre: dto.tallerNombre! })).id;
    } catch (e) {
      const otra = await buscar(); // alta simultánea con el mismo nombre
      if (otra) return otra.id;
      throw e;
    }
  }

  /** Lo que la app necesita para mostrar (o no) "Registrar service" y armar el formulario. */
  async contexto(tenantId: string, choferId: string) {
    const vacio = { vehiculo: null, kmActual: null, planes: [], talleres: [], tareas: [] };
    const { habilitado, conPlanes } = await this.tenant(tenantId);
    if (!habilitado) return { habilitado: false, ...vacio };
    const vehiculo = await this.vehiculoAsignado(tenantId, choferId);
    if (!vehiculo) return { habilitado: true, ...vacio };
    const [lectura, planes, talleres] = await Promise.all([
      this.odometro.getUltimaLectura(tenantId, vehiculo.id),
      conPlanes ? this.planesDelVehiculo(tenantId, vehiculo.id) : Promise.resolve([]),
      this.prisma.taller.findMany({
        where: { tenantId, activo: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return {
      habilitado: true,
      vehiculo,
      kmActual: lectura?.km ?? null,
      planes: planes.map((p) => ({ vehiculoPlanId: p.id, nombre: p.plan.nombre, tareas: p.plan.tareas })),
      talleres,
      tareas: TAREAS_MANTENIMIENTO_GRUPOS,
    };
  }

  /** Sube una foto del service (solo imágenes) a la carpeta de adjuntos de Mantenimiento de la empresa. */
  async subirFoto(tenantId: string, file: Express.Multer.File | undefined) {
    const { habilitado } = await this.tenant(tenantId);
    if (!habilitado) throw new ForbiddenException('Tu empresa no tiene habilitado Mantenimiento.');
    if (!file) throw new BadRequestException('Se requiere una imagen.');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('La foto tiene que ser una imagen.');
    return this.ordenes.subirAdjunto(tenantId, file);
  }

  async registrar(tenantId: string, choferId: string, dto: RegistrarServiceChoferDto) {
    const { habilitado, conPlanes } = await this.tenant(tenantId);
    if (!habilitado) throw new ForbiddenException('Tu empresa no tiene habilitado Mantenimiento.');
    const vehiculo = await this.vehiculoAsignado(tenantId, choferId);
    if (!vehiculo) {
      throw new BadRequestException('No tenés un vehículo asignado. Pedile a tu empresa que te asigne uno.');
    }
    const vehiculoPlanIds = conPlanes ? (dto.vehiculoPlanIds ?? []) : [];
    if (vehiculoPlanIds.length === 0 && !dto.tareas?.length && !dto.descripcion) {
      throw new BadRequestException('Contá qué se hizo: elegí un plan o una tarea, o escribí un comentario.');
    }

    // Tareas = las elegidas + las de los planes tildados (que `create` además valida que sean de este vehículo).
    const planes = vehiculoPlanIds.length ? await this.planesDelVehiculo(tenantId, vehiculo.id) : [];
    const tareas = [
      ...new Set([...(dto.tareas ?? []), ...planes.filter((p) => vehiculoPlanIds.includes(p.id)).flatMap((p) => p.plan.tareas)]),
    ];
    const tallerId = await this.resolverTaller(tenantId, dto);

    const orden = await this.ordenes.create(
      tenantId,
      `chofer:${choferId}`,
      {
        vehiculoId: vehiculo.id,
        tipo: 'preventivo',
        fecha: dto.fecha,
        km: dto.km ?? null,
        tallerId,
        tareas,
        descripcion: dto.descripcion || null,
        // `create` verifica que cada URL sea un adjunto de Mantenimiento de esta empresa.
        adjuntos: dto.adjuntos ?? [],
        vehiculoPlanIds,
      },
      ORIGEN_CHOFER,
    );
    return { id: orden.id, numero: orden.numero, patente: vehiculo.patente, warning: orden.warning };
  }
}
