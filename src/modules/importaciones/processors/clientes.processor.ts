import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { validarIdFiscal } from '../../../shared/util/validar-id-fiscal';
import type { IImportProcessor } from './import-processor.interface';
import type { ValidatedRow } from '../types/import.types';

@Injectable()
export class ClientesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: ValidatedRow, tenantId: string, _createdBy: string): Promise<string> {
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

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que un reimport no borre datos ya cargados que ese Excel no trae.
    const data = {
      idFiscal: idFiscal || undefined,
      pais: pais || undefined,
      email: (row.email as string | null)?.trim() || undefined,
      telefono: (row.telefono as string | null)?.trim() || undefined,
      direccion: (row.direccion as string | null)?.trim() || undefined,
    };

    const existing = await this.prisma.cliente.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.cliente.update({ where: { id: existing.id }, data });
      return existing.id;
    }

    const cliente = await this.prisma.cliente.create({
      data: { tenantId, nombre, ...data },
      select: { id: true },
    });

    return cliente.id;
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
