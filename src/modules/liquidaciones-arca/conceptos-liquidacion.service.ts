import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  CreateConceptoLiquidacionDto,
  UpdateConceptoLiquidacionDto,
} from './dto/concepto-liquidacion.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAny = any;

@Injectable()
export class ConceptosLiquidacionService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as PrismaAny;
  }

  list(tenantId: string, opts?: { soloActivos?: boolean }) {
    return this.db.conceptoLiquidacion.findMany({
      where: {
        tenantId,
        ...(opts?.soloActivos ? { activo: true } : {}),
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
  }

  async create(tenantId: string, dto: CreateConceptoLiquidacionDto) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Ingresá el nombre del concepto.');
    return this.db.conceptoLiquidacion.create({
      data: {
        tenantId,
        nombre,
        signo: dto.signo,
        ivaPct: dto.ivaPct,
        activo: true,
        updatedAt: new Date(),
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateConceptoLiquidacionDto) {
    const existing = await this.db.conceptoLiquidacion.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Concepto no encontrado');

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.nombre !== undefined) {
      const nombre = dto.nombre.trim();
      if (!nombre) throw new BadRequestException('Ingresá el nombre del concepto.');
      data.nombre = nombre;
    }
    if (dto.signo !== undefined) data.signo = dto.signo;
    if (dto.ivaPct !== undefined) data.ivaPct = dto.ivaPct;
    if (dto.activo !== undefined) data.activo = dto.activo;

    return this.db.conceptoLiquidacion.update({ where: { id }, data });
  }

  async findActivoOrThrow(tenantId: string, id: string) {
    const c = await this.db.conceptoLiquidacion.findFirst({
      where: { id, tenantId, activo: true },
    });
    if (!c) {
      throw new BadRequestException(
        'El concepto de liquidación no existe o está desactivado.',
      );
    }
    return c as {
      id: string;
      nombre: string;
      signo: 'favor' | 'contra';
      ivaPct: number;
    };
  }
}
