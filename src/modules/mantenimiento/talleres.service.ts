import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';
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

const conCantidadOrdenes = { _count: { select: { ordenes: true } } } satisfies Prisma.TallerInclude;

@Injectable()
export class TalleresService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, query: TalleresQueryDto) {
    return this.prisma.taller.findMany({
      where: { tenantId, ...(query.activo !== undefined ? { activo: query.activo === 'true' } : {}) },
      include: conCantidadOrdenes,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const taller = await this.prisma.taller.findFirst({ where: { id, tenantId }, include: conCantidadOrdenes });
    if (!taller) throw new NotFoundException('Taller no encontrado');
    return taller;
  }

  private async assertNombreDisponible(tenantId: string, nombre: string, excludeId?: string) {
    const existe = await this.prisma.taller.findFirst({
      where: {
        tenantId,
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existe) throw new ConflictException('Ya existe un taller con ese nombre.');
  }

  /** El `@@unique([tenantId, nombre])` de la DB puede saltar ante dos altas simultáneas. */
  private conflictoNombre(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('Ya existe un taller con ese nombre.');
    }
    throw e;
  }

  async create(tenantId: string, dto: CreateTallerDto) {
    const nombre = dto.nombre.trim();
    const cuit = parseCuitTaller(dto.cuit) ?? null;
    await this.assertNombreDisponible(tenantId, nombre);
    try {
      return await this.prisma.taller.create({
        data: {
          tenantId,
          nombre,
          cuit,
          telefono: textoOpcional(dto.telefono) ?? null,
          activo: dto.activo ?? true,
        },
        include: conCantidadOrdenes,
      });
    } catch (e) {
      this.conflictoNombre(e);
    }
  }

  async update(tenantId: string, id: string, dto: UpdateTallerDto) {
    const actual = await this.findOne(tenantId, id);
    const nombre = dto.nombre?.trim();
    if (nombre !== undefined && nombre.toLowerCase() !== actual.nombre.toLowerCase()) {
      await this.assertNombreDisponible(tenantId, nombre, id);
    }
    const cuit = parseCuitTaller(dto.cuit);
    const telefono = textoOpcional(dto.telefono);
    const data = {
      ...(nombre !== undefined ? { nombre } : {}),
      ...(cuit !== undefined ? { cuit } : {}),
      ...(telefono !== undefined ? { telefono } : {}),
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
    };
    let count: number;
    try {
      ({ count } = await this.prisma.taller.updateMany({ where: { id, tenantId }, data }));
    } catch (e) {
      this.conflictoNombre(e);
    }
    if (count === 0) throw new NotFoundException('Taller no encontrado');
    return this.findOne(tenantId, id);
  }

  /** Solo sin órdenes de trabajo: con `onDelete: SetNull` esas OT perderían el taller. */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const ordenes = await this.prisma.ordenTrabajo.count({ where: { tenantId, tallerId: id } });
    if (ordenes > 0) {
      throw new ConflictException('El taller tiene órdenes de trabajo. Desactivalo en vez de borrarlo.');
    }
    const { count } = await this.prisma.taller.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new NotFoundException('Taller no encontrado');
    return { id };
  }
}
