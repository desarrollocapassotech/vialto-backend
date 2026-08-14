import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { IImportProcessor } from './import-processor.interface';
import type { ValidatedRow } from '../types/import.types';

@Injectable()
export class ClientesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: ValidatedRow, tenantId: string, _createdBy: string): Promise<string> {
    const nombre = String(row.nombre ?? '').trim();
    const idFiscal = String(row.idFiscal ?? '').trim();
    const pais = String(row.pais ?? '').trim();
    if (!nombre || !idFiscal || !pais) {
      throw new BadRequestException(
        'Cada cliente importado requiere nombre, ID Fiscal y país',
      );
    }

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que un reimport no borre datos ya cargados que ese Excel no trae.
    const data = {
      idFiscal,
      pais,
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
}
