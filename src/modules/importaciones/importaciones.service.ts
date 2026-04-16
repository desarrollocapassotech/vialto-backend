import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ParserService } from './engine/parser.service';
import { ValidatorService } from './engine/validator.service';
import { ViajesProcessor } from './processors/viajes.processor';
import { ClientesProcessor } from './processors/clientes.processor';
import type { IImportProcessor } from './processors/import-processor.interface';
import type {
  TemplateConfig,
  ValidatedRow,
  ParsedRow,
  PreviewResult,
  PreviewViaje,
  PreviewFactura,
  PreviewEntidad,
} from './types/import.types';
import type { CreateTemplateDto } from './dto/create-template.dto';

@Injectable()
export class ImportacionesService {
  private readonly processors: Record<string, IImportProcessor>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly validator: ValidatorService,
    private readonly viajesProcessor: ViajesProcessor,
    private readonly clientesProcessor: ClientesProcessor,
  ) {
    this.processors = {
      viajes: this.viajesProcessor,
      clientes: this.clientesProcessor,
    };
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  async preview(
    tenantId: string,
    modulo: string,
    file: Express.Multer.File,
  ): Promise<PreviewResult> {
    const template = await this.getActiveTemplate(tenantId, modulo);
    const config = template.config as unknown as TemplateConfig;

    const parsed = this.parser.parse(file.buffer, config);
    if (parsed.length === 0) {
      throw new BadRequestException('El archivo no contiene filas de datos');
    }

    const { valid, errors, created } = await this.validator.validate(parsed, config.columns, tenantId);

    // Guardar sesión (expira en 30 minutos)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const session = await this.prisma.importSession.create({
      data: {
        tenantId,
        templateId: template.id,
        modulo,
        nombreArchivo: file.originalname,
        filasValidas: valid as unknown as object[],
        errores: errors as unknown as object[],
        totalFilas: parsed.length,
        expiresAt,
      },
      select: { id: true },
    });

    const result: PreviewResult = {
      sessionId: session.id,
      modulo,
      nombreArchivo: file.originalname,
      totalFilas: parsed.length,
      exitosas: valid.length,
      errores: errors.length,
      detalleErrores: errors,
    };

    if (modulo === 'viajes') {
      Object.assign(result, this.buildViajesPreview(parsed, valid, created));
    }

    return result;
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  async confirm(tenantId: string, sessionId: string, createdBy: string) {
    const session = await this.prisma.importSession.findFirst({
      where: { id: sessionId, tenantId },
    });

    if (!session) throw new NotFoundException('Sesión de importación no encontrada');
    if (session.expiresAt < new Date()) {
      await this.prisma.importSession.delete({ where: { id: sessionId } });
      throw new GoneException('La sesión expiró. Volvé a subir el archivo para generar una nueva previsualización');
    }

    const processor = this.processors[session.modulo];
    if (!processor) {
      throw new BadRequestException(`No hay processor para el módulo "${session.modulo}"`);
    }

    const filasValidas = session.filasValidas as unknown as ValidatedRow[];
    const detalles: object[] = [];
    let exitosas = 0;
    let errores = 0;

    for (const fila of filasValidas) {
      try {
        const id = await processor.insert(fila, tenantId, createdBy);
        detalles.push({ fila: fila._rowNum, estado: 'ok', id });
        exitosas++;
      } catch (err: unknown) {
        const mensaje = err instanceof Error ? err.message : 'Error inesperado';
        detalles.push({ fila: fila._rowNum, estado: 'error', mensaje });
        errores++;
      }
    }

    const estado =
      errores === 0 ? 'completado' : exitosas === 0 ? 'fallido' : 'con_errores';

    const log = await this.prisma.importLog.create({
      data: {
        tenantId,
        templateId: session.templateId,
        modulo: session.modulo,
        nombreArchivo: session.nombreArchivo,
        estado,
        totalFilas: session.totalFilas,
        exitosas,
        errores,
        detalles,
        createdBy,
      },
    });

    await this.prisma.importSession.delete({ where: { id: sessionId } });

    return log;
  }

  // ── Logs ──────────────────────────────────────────────────────────────────

  getLogs(tenantId: string, modulo?: string) {
    return this.prisma.importLog.findMany({
      where: { tenantId, ...(modulo ? { modulo } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        modulo: true,
        nombreArchivo: true,
        estado: true,
        totalFilas: true,
        exitosas: true,
        errores: true,
        createdAt: true,
        createdBy: true,
      },
    });
  }

  async getLog(tenantId: string, id: string) {
    const log = await this.prisma.importLog.findFirst({
      where: { id, tenantId },
    });
    if (!log) throw new NotFoundException('Log de importación no encontrado');
    return log;
  }

  // ── Templates (admin) ─────────────────────────────────────────────────────

  createTemplate(dto: CreateTemplateDto) {
    return this.prisma.importTemplate.upsert({
      where: { tenantId_modulo: { tenantId: dto.tenantId, modulo: dto.modulo } },
      create: {
        tenantId: dto.tenantId,
        modulo: dto.modulo,
        nombre: dto.nombre,
        config: dto.config as object,
        activo: dto.activo ?? true,
      },
      update: {
        nombre: dto.nombre,
        config: dto.config as object,
        activo: dto.activo ?? true,
      },
    });
  }

  getTemplates(tenantId: string) {
    return this.prisma.importTemplate.findMany({
      where: { tenantId },
      orderBy: { modulo: 'asc' },
      select: { id: true, modulo: true, nombre: true, activo: true, updatedAt: true },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildViajesPreview(
    parsed: ParsedRow[],
    valid: ValidatedRow[],
    created: { clientes: string[]; transportistas: string[]; choferes: string[] },
  ): { viajes: PreviewViaje[]; facturas: PreviewFactura[]; clientes: PreviewEntidad[]; transportistas: PreviewEntidad[] } {
    const parsedByRow = new Map(parsed.map((r) => [r._rowNum, r]));
    const newClienteNames = new Set(created.clientes.map((n) => n.toLowerCase()));
    const newTransportistaNames = new Set(created.transportistas.map((n) => n.toLowerCase()));

    const viajes: PreviewViaje[] = [];
    const facturas: PreviewFactura[] = [];
    const clienteNamesSet = new Set<string>();
    const transportistaNamesSet = new Set<string>();

    const toStr = (v: unknown): string | null =>
      v != null && String(v).trim() ? String(v).trim() : null;

    const toNum = (v: unknown): number | null =>
      v != null && !isNaN(Number(v)) ? Number(v) : null;

    const toDateStr = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toLocaleDateString('es-AR');
      return toStr(v);
    };

    for (const validRow of valid) {
      const p = parsedByRow.get(validRow._rowNum);
      if (!p) continue;

      const cliente = toStr(p.clienteId) ?? '';
      const transporte = toStr(p.transportistaId);
      if (cliente) clienteNamesSet.add(cliente);
      if (transporte) transportistaNamesSet.add(transporte);

      const monto = toNum(p.monto);
      const precioTransp = toNum(p.precioTransportistaExterno);
      const nroFactura = toStr(p.nroFactura);
      const nroFacturaTransporte = toStr(p.nroFacturaTransporte);

      viajes.push({
        fila: validRow._rowNum,
        cliente,
        transporte,
        origen: toStr(p.origen),
        destino: toStr(p.destino),
        fechaCarga: toDateStr(p.fechaCarga),
        fechaDescarga: toDateStr(p.fechaDescarga),
        detalleCarga: toStr(p.detalleCarga),
        monto,
        nroFactura,
        precioTransportistaExterno: precioTransp,
        nroFacturaTransporte,
      });

      if (nroFactura) {
        facturas.push({
          tipo: 'cliente',
          numero: nroFactura,
          nombre: cliente || null,
          importe: monto ?? 0,
          fechaEmision: toDateStr(p.fechaEmisionFactura),
          fechaVencimiento: toDateStr(p.fechaVencimientoFactura),
        });
      }

      if (nroFacturaTransporte) {
        facturas.push({
          tipo: 'transportista_externo',
          numero: nroFacturaTransporte,
          nombre: transporte,
          importe: precioTransp ?? 0,
          fechaEmision: toDateStr(p.fechaEmisionFacturaTransp),
          fechaVencimiento: toDateStr(p.fechaVencimientoFacturaTransp),
        });
      }
    }

    return {
      viajes,
      facturas,
      clientes: [...clienteNamesSet].map((nombre) => ({ nombre, esNuevo: newClienteNames.has(nombre.toLowerCase()) })),
      transportistas: [...transportistaNamesSet].map((nombre) => ({ nombre, esNuevo: newTransportistaNames.has(nombre.toLowerCase()) })),
    };
  }

  private async getActiveTemplate(tenantId: string, modulo: string) {
    const template = await this.prisma.importTemplate.findFirst({
      where: { tenantId, modulo, activo: true },
    });
    if (!template) {
      throw new NotFoundException(
        `No hay template activo de importación para el módulo "${modulo}". Contactá a soporte.`,
      );
    }
    return template;
  }
}
