import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';
import { TransportistasService } from '../../core/transportistas/transportistas.service';
import { CreateTallerDto } from './dto/create-taller.dto';
import { UpdateTallerDto } from './dto/update-taller.dto';
import { TalleresQueryDto } from './dto/talleres-query.dto';

/**
 * CUIT opcional del taller: se guarda solo con dígitos y, si viene, tiene que ser válido.
 * `undefined` = no vino (no se toca); vacío o `null` = se borra.
 */
export function parseCuitTaller(cuit: string | null | undefined): string | null | undefined {
  if (cuit === undefined) return undefined;
  if (cuit === null || cuit.trim() === '') return null;
  const digitos = normalizarCuit(cuit);
  if (!cuitDigitoVerificadorValido(digitos)) {
    throw new BadRequestException('El CUIT del taller no es válido (11 dígitos con dígito verificador correcto).');
  }
  return digitos;
}

function textoOpcional(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === null || v.trim() === '' ? null : v.trim();
}

const TIPO_TALLER = 'taller';

const selectTaller = {
  id: true,
  nombre: true,
  idFiscal: true,
  telefono: true,
  activo: true,
  _count: { select: { ordenesTrabajo: true } },
} satisfies Prisma.TransportistaSelect;

type TallerRow = Prisma.TransportistaGetPayload<{ select: typeof selectTaller }>;

/** Mismo contrato de siempre de `/mantenimiento/talleres` (front y app de choferes). */
function aTaller(r: TallerRow) {
  return {
    id: r.id,
    nombre: r.nombre,
    cuit: r.idFiscal,
    telefono: r.telefono,
    activo: r.activo,
    interno: false,
    _count: { ordenes: r._count.ordenesTrabajo },
  };
}

/**
 * Talleres de Mantenimiento (nov 2026): ya no son una entidad propia, son proveedores
 * (tabla `transportistas`) de tipo "taller". Se dan de alta también desde Base de datos →
 * Proveedores; este service queda para el selector y la alta rápida de la OT y de la app
 * de choferes.
 */
@Injectable()
export class TalleresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: TalleresQueryDto) {
    const rows = await this.prisma.transportista.findMany({
      where: {
        tenantId,
        tipo: TIPO_TALLER,
        ...(query.activo !== undefined ? { activo: query.activo === 'true' } : {}),
      },
      select: selectTaller,
      orderBy: { nombre: 'asc' },
    });
    return rows.map(aTaller);
  }

  async findOne(tenantId: string, id: string) {
    const taller = await this.prisma.transportista.findFirst({
      where: { id, tenantId, tipo: TIPO_TALLER },
      select: selectTaller,
    });
    if (!taller) throw new NotFoundException('Taller no encontrado');
    return aTaller(taller);
  }

  private async assertNombreDisponible(tenantId: string, nombre: string, excludeId?: string) {
    const existe = await this.prisma.transportista.findFirst({
      where: {
        tenantId,
        tipo: TIPO_TALLER,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existe) throw new ConflictException('Ya existe un taller con ese nombre.');
  }

  async create(tenantId: string, dto: CreateTallerDto) {
    const nombre = dto.nombre.trim();
    const cuit = parseCuitTaller(dto.cuit) ?? null;
    await this.assertNombreDisponible(tenantId, nombre);
    await TransportistasService.assertIdFiscalDisponible(this.prisma, tenantId, cuit);
    const creado = await this.prisma.transportista.create({
      data: {
        tenantId,
        tipo: TIPO_TALLER,
        nombre,
        idFiscal: cuit,
        pais: cuit ? 'AR' : null,
        telefono: textoOpcional(dto.telefono) ?? null,
        activo: dto.activo ?? true,
      },
      select: selectTaller,
    });
    return aTaller(creado);
  }

  async update(tenantId: string, id: string, dto: UpdateTallerDto) {
    const actual = await this.findOne(tenantId, id);
    const nombre = dto.nombre?.trim();
    if (nombre !== undefined && nombre.toLowerCase() !== actual.nombre.toLowerCase()) {
      await this.assertNombreDisponible(tenantId, nombre, id);
    }
    const cuit = parseCuitTaller(dto.cuit);
    if (cuit) await TransportistasService.assertIdFiscalDisponible(this.prisma, tenantId, cuit, id);
    const telefono = textoOpcional(dto.telefono);
    const data: Prisma.TransportistaUpdateManyMutationInput = {
      ...(nombre !== undefined ? { nombre } : {}),
      ...(cuit !== undefined ? { idFiscal: cuit, ...(cuit ? { pais: 'AR' } : {}) } : {}),
      ...(telefono !== undefined ? { telefono } : {}),
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
    };
    const { count } = await this.prisma.transportista.updateMany({
      where: { id, tenantId, tipo: TIPO_TALLER },
      data,
    });
    if (count === 0) throw new NotFoundException('Taller no encontrado');
    return this.findOne(tenantId, id);
  }

  /** Solo sin órdenes de trabajo ni cuenta corriente: si tiene, desactivarlo. */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const [ordenes, movimientos] = await Promise.all([
      this.prisma.ordenTrabajo.count({ where: { tenantId, tallerId: id } }),
      this.prisma.movimientoCuentaCorriente.count({ where: { tenantId, proveedorId: id } }),
    ]);
    if (ordenes > 0 || movimientos > 0) {
      throw new ConflictException(
        'El taller tiene órdenes de trabajo o cuenta corriente. Desactivalo en vez de borrarlo.',
      );
    }
    const { count } = await this.prisma.transportista.deleteMany({
      where: { id, tenantId, tipo: TIPO_TALLER },
    });
    if (count === 0) throw new NotFoundException('Taller no encontrado');
    return { id };
  }
}
