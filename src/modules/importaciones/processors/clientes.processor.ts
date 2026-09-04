import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { validarIdFiscal } from '../../../shared/util/validar-id-fiscal';
import type { IImportProcessor, InsertResult } from './import-processor.interface';
import type { IdFiscalConflicto, ValidatedRow } from '../types/import.types';
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

    // El usuario ya eligió "actualizar" este cliente puntual desde el
    // preview (conflicto de ID Fiscal resuelto en ImportacionesService.confirm)
    // — se pisa directo el registro que ya tenía ese CUIT, incluido el
    // nombre (a diferencia del upsert por nombre de abajo, que lo deja fijo).
    const idFiscalClienteId =
      typeof row._idFiscalClienteId === 'string' ? row._idFiscalClienteId : null;
    if (idFiscalClienteId) {
      const dataActualizar = scalarDataFromRow(row, 'Cliente');
      await this.prisma.cliente.update({
        where: { id: idFiscalClienteId },
        data: dataActualizar,
      });
      return { id: idFiscalClienteId, creado: false };
    }

    // Scalars del modelo: un campo nuevo en Prisma se copia solo. Vacío =
    // omitido, para que un reimport no borre datos que ese Excel no trae.
    const data = scalarDataFromRow(row, 'Cliente', { skip: ['nombre'] });

    const existing = await this.prisma.cliente.findFirst({
      where: { tenantId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });

    // Mismo criterio que el alta/edición manual (ClientesService): un CUIT no
    // puede pertenecer a dos clientes distintos del mismo tenant. El preview
    // ya detecta este caso (`detectarIdFiscalDuplicado`) y le hace elegir al
    // usuario ignorar/actualizar antes de confirmar — esto es la red de
    // seguridad final para lo que se cuele sin pasar por esa decisión (ej.
    // dos filas del mismo Excel con igual CUIT nuevo, ninguna existente
    // todavía cuando se armó el preview).
    if (idFiscal) {
      const duplicado = await this.prisma.cliente.findFirst({
        where: {
          tenantId,
          idFiscal,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new BadRequestException(
          `Ya existe otro cliente con el ID Fiscal "${idFiscal}"`,
        );
      }
    }

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

  /**
   * Filas cuyo ID Fiscal ya pertenece a OTRO cliente existente (nombre
   * distinto) — si el nombre coincide, es el mismo cliente actualizándose,
   * no un conflicto. Usado por el preview (`ImportacionesService.preview`)
   * y recalculado en vivo por `confirm()` porque la base puede haber
   * cambiado desde que se armó el preview.
   */
  async detectarIdFiscalDuplicado(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<IdFiscalConflicto[]> {
    const candidatas = rows.filter(
      (r) => typeof r.idFiscal === 'string' && r.idFiscal.trim(),
    );
    if (candidatas.length === 0) return [];

    const idFiscales = [
      ...new Set(candidatas.map((r) => String(r.idFiscal).trim())),
    ];
    const existentes = await this.prisma.cliente.findMany({
      where: { tenantId, idFiscal: { in: idFiscales } },
      select: { id: true, nombre: true, idFiscal: true },
    });
    const porIdFiscal = new Map(
      existentes.map((e) => [e.idFiscal as string, e]),
    );

    const conflictos: IdFiscalConflicto[] = [];
    for (const row of candidatas) {
      const idFiscal = String(row.idFiscal).trim();
      const match = porIdFiscal.get(idFiscal);
      if (!match) continue;
      const nombreFila = String(row.nombre ?? '').trim().toLowerCase();
      if (match.nombre.trim().toLowerCase() === nombreFila) continue;
      conflictos.push({
        fila: row._rowNum,
        idFiscal,
        clienteExistenteId: match.id,
        clienteExistenteNombre: match.nombre,
      });
    }
    return conflictos;
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

  async filasNuevas(rows: ValidatedRow[], tenantId: string): Promise<Set<number>> {
    const existentes = await this.prisma.cliente.findMany({
      where: { tenantId },
      select: { nombre: true },
    });
    const nombresExistentes = new Set(
      existentes.map((c) => c.nombre.trim().toLowerCase()),
    );
    const nuevas = new Set<number>();
    for (const r of rows) {
      const nombre = String(r.nombre ?? '').trim();
      if (nombre && !nombresExistentes.has(nombre.toLowerCase())) {
        nuevas.add(r._rowNum);
      }
    }
    return nuevas;
  }
}
