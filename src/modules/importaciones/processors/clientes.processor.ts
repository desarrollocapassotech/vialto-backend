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

    const cliente = await this.prisma.cliente.create({
      data: {
        tenantId,
        nombre,
        idFiscal,
        pais,
        email: (row.email as string | null)?.trim() || null,
        telefono: (row.telefono as string | null)?.trim() || null,
        direccion: (row.direccion as string | null)?.trim() || null,
      },
      select: { id: true },
    });

    return cliente.id;
  }
}
