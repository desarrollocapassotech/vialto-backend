import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import type { IImportProcessor } from './import-processor.interface';
import type { ValidatedRow } from '../types/import.types';

@Injectable()
export class ClientesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(row: ValidatedRow, tenantId: string, _createdBy: string): Promise<string> {
    const cliente = await this.prisma.cliente.create({
      data: {
        tenantId,
        nombre: row.nombre as string,
        cuit: (row.cuit as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        telefono: (row.telefono as string | null) ?? null,
        direccion: (row.direccion as string | null) ?? null,
      },
      select: { id: true },
    });

    return cliente.id;
  }
}
