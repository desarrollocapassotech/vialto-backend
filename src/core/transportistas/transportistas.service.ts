import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTransportistaDto } from './dto/create-transportista.dto';
import { UpdateTransportistaDto } from './dto/update-transportista.dto';
import {
  ProveedoresFiltroQueryDto,
  TransportistasPaginatedQueryDto,
} from './dto/transportistas-paginated-query.dto';
import { validarIdFiscal } from '../../shared/util/validar-id-fiscal';
import { normalizarIdFiscal } from '../../shared/util/documento-unico.util';
import { PROVEEDOR_TIPO_LABEL, type ProveedorTipo } from '../../shared/util/proveedor-tipo';

/** Para comparar categorías: sin mayúsculas, acentos ni espacios de más. */
function claveCategoria(c: string): string {
  return c
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Proveedores de la empresa (tabla `transportistas`, nov 2026). Además de los
 * transportistas, guarda talleres (Mantenimiento) y cualquier otro proveedor
 * (Cuenta corriente) — ver `shared/util/proveedor-tipo.ts`.
 */
@Injectable()
export class TransportistasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sin `tipo` = solo transportistas (los selectores de siempre). */
  static whereFiltro(
    tenantId: string,
    filtro: { tipo?: string; activo?: 'true' | 'false' } = {},
  ): Prisma.TransportistaWhereInput {
    const tipo = filtro.tipo ?? 'transportista';
    return {
      tenantId,
      ...(tipo !== 'todos' ? { tipo } : {}),
      ...(filtro.activo !== undefined ? { activo: filtro.activo === 'true' } : {}),
    };
  }

  findAll(tenantId: string, filtro: ProveedoresFiltroQueryDto = {}) {
    return this.prisma.transportista.findMany({
      where: TransportistasService.whereFiltro(tenantId, filtro),
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Tipos propios ("otro" con nombre) que ya usó la empresa, sin repetir y en orden
   * alfabético: son las opciones extra del selector de tipo al dar de alta un proveedor.
   */
  async categorias(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.transportista.findMany({
      where: { tenantId, tipo: 'otro', categoria: { not: null } },
      select: { categoria: true },
      distinct: ['categoria'],
    });
    const porClave = new Map<string, string>();
    for (const r of rows) {
      const c = r.categoria?.trim();
      if (c && !porClave.has(claveCategoria(c))) porClave.set(claveCategoria(c), c);
    }
    return [...porClave.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  /**
   * Categoría a guardar: sin espacios de más y, si la empresa ya tiene una igual (sin
   * importar mayúsculas ni acentos), con esa misma escritura — así "combustible" y
   * "Combustible" no quedan como dos tipos distintos.
   */
  private async normalizarCategoria(tenantId: string, categoria: string): Promise<string> {
    const limpia = categoria.trim().replace(/\s+/g, ' ');
    const existentes = await this.categorias(tenantId);
    return existentes.find((c) => claveCategoria(c) === claveCategoria(limpia)) ?? limpia;
  }

  async findAllPaginated(tenantId: string, query: TransportistasPaginatedQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = TransportistasService.whereFiltro(tenantId, query);
    const categoria = query.categoria?.trim();
    if (categoria) where.categoria = { equals: categoria, mode: 'insensitive' };

    const nombre = query.nombre?.trim();
    if (nombre) where.nombre = { contains: nombre, mode: 'insensitive' };

    const idFiscal = normalizarIdFiscal(query.idFiscal);
    if (idFiscal) where.idFiscal = { contains: idFiscal, mode: 'insensitive' };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transportista.count({ where }),
      this.prisma.transportista.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Proveedor no encontrado');
    return row;
  }

  private assertTransportistaRequiredFields(
    data: {
      nombre: string;
      pais?: string | null;
      idFiscal?: string | null;
    },
    confirmarSinDatosFiscales?: boolean,
  ) {
    if (!data.nombre?.trim()) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    // País e ID Fiscal son recomendados (los necesita Facturación/
    // Liquidaciones más adelante), no obligatorios — si faltan, hace falta
    // que el usuario lo confirme explícitamente antes de guardar.
    if ((!data.pais?.trim() || !data.idFiscal?.trim()) && !confirmarSinDatosFiscales) {
      throw new BadRequestException(
        'Falta el país y/o el ID Fiscal — confirmá que querés guardar igual sin esos datos.',
      );
    }
  }

  /** Un CUIT es un solo proveedor, sea del tipo que sea. */
  static async assertIdFiscalDisponible(
    prisma: PrismaService,
    tenantId: string,
    idFiscal: string | null,
    excludeId?: string,
  ) {
    if (!idFiscal) return;
    const existente = await prisma.transportista.findFirst({
      where: { tenantId, idFiscal, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, nombre: true, tipo: true },
    });
    if (existente) {
      const tipo = PROVEEDOR_TIPO_LABEL[existente.tipo as ProveedorTipo] ?? existente.tipo;
      throw new ConflictException(
        `Ya existe un proveedor con ese ID Fiscal: ${existente.nombre} (${tipo.toLowerCase()})`,
      );
    }
  }

  /**
   * Qué impide cambiarle el tipo o borrar a un proveedor: lo que ya tiene cargado como
   * transportista (viajes, liquidaciones, choferes, vehículos, facturas) o como taller (OT).
   * La cuenta corriente no cuenta para el tipo: es de cualquier proveedor.
   */
  private async usos(tenantId: string, id: string) {
    const w = { tenantId };
    const [viajes, viajesEfectivo, liquidaciones, choferes, vehiculos, facturas, ordenes, movimientosCc] =
      await Promise.all([
        this.prisma.viaje.count({ where: { ...w, transportistaId: id } }),
        this.prisma.viaje.count({ where: { ...w, transportistaEfectivoId: id } }),
        this.prisma.liquidacion.count({ where: { ...w, transportistaId: id } }),
        this.prisma.chofer.count({ where: { ...w, transportistaId: id } }),
        this.prisma.vehiculo.count({ where: { ...w, transportistaId: id } }),
        this.prisma.factura.count({ where: { ...w, transportistaId: id } }),
        this.prisma.ordenTrabajo.count({ where: { ...w, tallerId: id } }),
        this.prisma.movimientoCuentaCorriente.count({ where: { ...w, proveedorId: id } }),
      ]);
    return {
      comoTransportista: viajes + viajesEfectivo + liquidaciones + choferes + vehiculos + facturas,
      comoTaller: ordenes,
      movimientosCc,
    };
  }

  private async assertCambioTipoPermitido(
    tenantId: string,
    id: string,
    actual: string,
    nuevo: string,
  ) {
    if (actual === nuevo) return;
    const u = await this.usos(tenantId, id);
    if (actual === 'transportista' && u.comoTransportista > 0) {
      throw new ConflictException(
        'Este proveedor ya tiene viajes, liquidaciones, choferes o vehículos como transportista: no se le puede cambiar el tipo.',
      );
    }
    if (actual === 'taller' && u.comoTaller > 0) {
      throw new ConflictException(
        'Este proveedor ya tiene órdenes de trabajo como taller: no se le puede cambiar el tipo.',
      );
    }
  }

  async create(tenantId: string, dto: CreateTransportistaDto) {
    this.assertTransportistaRequiredFields(dto, dto.confirmarSinDatosFiscales);
    const pais = dto.pais?.trim() || null;
    validarIdFiscal(pais, dto.idFiscal?.trim() || null);
    const idFiscal = normalizarIdFiscal(dto.idFiscal);
    await TransportistasService.assertIdFiscalDisponible(this.prisma, tenantId, idFiscal);
    const tipo = dto.tipo ?? 'transportista';
    const esTransportista = tipo === 'transportista';
    let categoria: string | null = null;
    if (tipo === 'otro') {
      if (!dto.categoria?.trim()) {
        throw new BadRequestException('Escribí qué tipo de proveedor es (ej. Combustible, Gomería).');
      }
      categoria = await this.normalizarCategoria(tenantId, dto.categoria);
    }
    try {
      return await this.prisma.transportista.create({
        data: {
          tenantId,
          tipo,
          categoria,
          activo: dto.activo ?? true,
          nombre: dto.nombre.trim(),
          pais,
          idFiscal,
          email: dto.email?.trim() || null,
          telefono: dto.telefono?.trim() || null,
          domicilio: dto.domicilio?.trim() || null,
          condicionIva: dto.condicionIva ?? null,
          condicionTributaria: dto.condicionTributaria?.trim() || null,
          // PAUT y permiso internacional son datos de un transportista.
          paut: esTransportista ? dto.paut?.trim() || null : null,
          permisoInternacional: esTransportista ? dto.permisoInternacional?.trim() || null : null,
          fechaVencimientoPermiso:
            esTransportista && dto.fechaVencimientoPermiso
              ? new Date(dto.fechaVencimientoPermiso)
              : null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un proveedor con ese ID Fiscal');
      }
      throw e;
    }
  }

  async update(id: string, tenantId: string, dto: UpdateTransportistaDto) {
    const current = await this.findOne(id, tenantId);
    const tipo = dto.tipo ?? current.tipo;
    await this.assertCambioTipoPermitido(tenantId, id, current.tipo, tipo);
    // Categoría: solo en tipo "otro", y siempre con nombre (no hay "otro sin especificar").
    // Activar/desactivar sin tocar el tipo no la pide, para no trabar datos viejos.
    let categoria: string | null = null;
    if (tipo === 'otro') {
      const pedida = dto.categoria !== undefined ? dto.categoria.trim() : (current.categoria ?? '');
      const tocaTipo = dto.tipo !== undefined || dto.categoria !== undefined;
      if (!pedida && tocaTipo) {
        throw new BadRequestException('Escribí qué tipo de proveedor es (ej. Combustible, Gomería).');
      }
      categoria = pedida ? await this.normalizarCategoria(tenantId, pedida) : null;
    }
    const next = {
      tipo,
      categoria,
      activo: dto.activo ?? current.activo,
      nombre: dto.nombre !== undefined ? dto.nombre.trim() : current.nombre,
      pais:
        (dto.pais !== undefined ? dto.pais.trim() : (current.pais ?? '')) ||
        null,
      idFiscal:
        (dto.idFiscal !== undefined
          ? dto.idFiscal.trim()
          : (current.idFiscal ?? '')) || null,
      email: dto.email !== undefined ? dto.email?.trim() || null : current.email,
      telefono: dto.telefono !== undefined ? dto.telefono?.trim() || null : current.telefono,
      domicilio:
        dto.domicilio !== undefined ? dto.domicilio?.trim() || null : current.domicilio,
      condicionIva:
        dto.condicionIva !== undefined ? dto.condicionIva : current.condicionIva,
      condicionTributaria:
        dto.condicionTributaria !== undefined
          ? dto.condicionTributaria?.trim() || null
          : current.condicionTributaria,
      paut: dto.paut !== undefined ? dto.paut?.trim() || null : current.paut,
      permisoInternacional:
        dto.permisoInternacional !== undefined
          ? dto.permisoInternacional?.trim() || null
          : current.permisoInternacional,
      fechaVencimientoPermiso:
        dto.fechaVencimientoPermiso === undefined
          ? current.fechaVencimientoPermiso
          : dto.fechaVencimientoPermiso
            ? new Date(dto.fechaVencimientoPermiso)
            : null,
    };
    if (tipo !== 'transportista') {
      next.paut = null;
      next.permisoInternacional = null;
      next.fechaVencimientoPermiso = null;
    }
    // Activar/desactivar (o cambiar algo que no son los datos fiscales) no pide volver a
    // confirmar que faltan país o ID Fiscal: eso se confirmó al darlo de alta.
    const tocaDatosFiscales = dto.pais !== undefined || dto.idFiscal !== undefined;
    this.assertTransportistaRequiredFields(
      next,
      tocaDatosFiscales ? dto.confirmarSinDatosFiscales : true,
    );
    validarIdFiscal(next.pais, next.idFiscal);
    next.idFiscal = normalizarIdFiscal(next.idFiscal);
    await TransportistasService.assertIdFiscalDisponible(this.prisma, tenantId, next.idFiscal, id);
    try {
      const { count } = await this.prisma.transportista.updateMany({
        where: { id, tenantId },
        data: next,
      });
      if (count === 0) throw new NotFoundException('Proveedor no encontrado');
      return this.findOne(id, tenantId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un proveedor con ese ID Fiscal');
      }
      throw e;
    }
  }

  /** Solo sin historial: con viajes, OT o cuenta corriente se desactiva en vez de borrar. */
  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    const u = await this.usos(tenantId, id);
    if (u.comoTransportista + u.comoTaller + u.movimientosCc > 0) {
      throw new ConflictException(
        'El proveedor tiene historial (viajes, órdenes de trabajo o cuenta corriente). Desactivalo en vez de borrarlo.',
      );
    }
    const { count } = await this.prisma.transportista.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Proveedor no encontrado');
    return { id };
  }
}
