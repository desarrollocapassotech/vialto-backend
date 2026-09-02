import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { validarIdFiscal } from '../../../shared/util/validar-id-fiscal';
import type { IImportProcessor, InsertResult } from './import-processor.interface';
import type { ValidatedRow } from '../types/import.types';
import { scalarDataFromRow } from '../prisma-import-fields';

@Injectable()
export class ClientesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: ValidatedRow, tenantId: string, _createdBy: string): Promise<InsertResult> {
    const nombre = String(row.nombre ?? '').trim();
    const idFiscal = String(row.idFiscal ?? '').trim();
    const pais = String(row.pais ?? '').trim();
    if (!nombre) {
      throw new BadRequestException('Cada cliente importado requiere nombre');
    }
    // CUIT/país son recomendados (warnIfEmpty en el template), no obligatorios:
    // el usuario ya confirmó explícitamente que quiere importar sin ellos si
    // llegamos hasta acá (ver ImportacionesService.confirm). Solo validamos
    // el formato del ID fiscal cuando ambos vienen completos.
    if (idFiscal && pais) {
      validarIdFiscal(pais, idFiscal);
    }

    // Scalars del modelo: un campo nuevo en Prisma se copia solo. Vacío =
    // omitido, para que un reimport no borre datos que ese Excel no trae.
    const data = scalarDataFromRow(row, 'Cliente', { skip: ['nombre'] });

    const existing = await this.prisma.cliente.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.cliente.update({ where: { id: existing.id }, data });
      return { id: existing.id, creado: false };
    }

    const cliente = await this.prisma.cliente.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });

    return { id: cliente.id, creado: true };
  }

  async contarExistentes(rows: ValidatedRow[], tenantId: string): Promise<number> {
    const existentes = await this.prisma.cliente.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((c) => c.nombre.trim().toLowerCase()),
    );
    return rows.filter((r) =>
      nombresExistentes.has(String(r.nombre ?? '').trim().toLowerCase()),
    ).length;
  }
}
