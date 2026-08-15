import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ParserService } from "./engine/parser.service";
import { ValidatorService } from "./engine/validator.service";
import { ViajesProcessor } from "./processors/viajes.processor";
import { ClientesProcessor } from "./processors/clientes.processor";
import { TransportistasProcessor } from "./processors/transportistas.processor";
import { ChoferesProcessor } from "./processors/choferes.processor";
import { VehiculosProcessor } from "./processors/vehiculos.processor";
import type { IImportProcessor } from "./processors/import-processor.interface";
import type {
  TemplateConfig,
  ValidatedRow,
  ParsedRow,
  PreviewResult,
  PreviewViaje,
  PreviewFactura,
  PreviewEntidad,
  RowError,
  EntidadesFaltantesModelo,
} from "./types/import.types";
import type { CreateTemplateDto } from "./dto/create-template.dto";
import { TEMPLATE_CATALOGO, construirConfigPorDefecto } from "./template-catalogo";
import { IaTemplateSuggestionService, type SugerenciaTemplate } from "./ia-template-suggestion.service";
import { VehiculosService } from "../../core/vehiculos/vehiculos.service";

@Injectable()
export class ImportacionesService {
  private readonly processors: Record<string, IImportProcessor>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly validator: ValidatorService,
    private readonly viajesProcessor: ViajesProcessor,
    private readonly clientesProcessor: ClientesProcessor,
    private readonly transportistasProcessor: TransportistasProcessor,
    private readonly choferesProcessor: ChoferesProcessor,
    private readonly vehiculosProcessor: VehiculosProcessor,
    private readonly iaTemplateSuggestion: IaTemplateSuggestionService,
    private readonly vehiculosService: VehiculosService,
  ) {
    this.processors = {
      viajes: this.viajesProcessor,
      clientes: this.clientesProcessor,
      transportistas: this.transportistasProcessor,
      choferes: this.choferesProcessor,
      vehiculos: this.vehiculosProcessor,
    };
  }

  /**
   * Defensa en profundidad: el frontend ya oculta la pantalla si
   * `Tenant.importacionesOcultas`, pero un admin de tenant no debería poder
   * saltearlo pegándole directo al endpoint. El superadmin nunca queda
   * bloqueado por este flag — es una restricción sobre el tenant, no sobre
   * la herramienta.
   */
  private async assertImportacionesVisible(
    tenantId: string,
    isSuperadmin: boolean,
  ) {
    if (isSuperadmin) return;
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { importacionesOcultas: true },
    });
    if (tenant?.importacionesOcultas) {
      throw new BadRequestException(
        "La importación masiva no está disponible para esta empresa.",
      );
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  async preview(
    tenantId: string,
    modulo: string,
    buffer: Buffer,
    originalname: string,
    isSuperadmin: boolean,
  ): Promise<PreviewResult> {
    await this.assertImportacionesVisible(tenantId, isSuperadmin);
    const template = await this.getActiveTemplate(tenantId, modulo);
    const config = template.config as unknown as TemplateConfig;

    const { rows: parsed, headers: headersExcel } = this.parser.parse(
      buffer,
      config,
    );
    if (parsed.length === 0) {
      throw new BadRequestException("El archivo no contiene filas de datos");
    }

    const { valid, errors, created } = await this.validator.validate(
      parsed,
      config.columns,
      tenantId,
      true,
    );

    const headersExcelLower = new Set(
      headersExcel.map((h) => h.toLowerCase()),
    );
    const headersNoMapeados = headersExcel.filter(
      (h) =>
        !config.columns.some(
          (c) => c.excelHeader.toLowerCase() === h.toLowerCase(),
        ),
    );
    const columnasOpcionalesFaltantes = config.columns
      .filter(
        (c) => !c.required && !headersExcelLower.has(c.excelHeader.toLowerCase()),
      )
      .map((c) => c.excelHeader);

    const entidadesFaltantes = this.agruparEntidadesFaltantes(errors);

    // Guardar sesión (expira en 30 minutos)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const session = await this.prisma.importSession.create({
      data: {
        tenantId,
        templateId: template.id,
        nombreArchivo: originalname,
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
      nombreArchivo: originalname,
      totalFilas: parsed.length,
      exitosas: valid.length,
      errores: errors.length,
      detalleErrores: errors,
      headersNoMapeados,
      columnasOpcionalesFaltantes,
      entidadesFaltantes,
    };

    if (modulo === "viajes") {
      Object.assign(result, this.buildViajesPreview(parsed, valid, created));
    }

    return result;
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  async confirm(
    tenantId: string,
    sessionId: string,
    createdBy: string,
    isSuperadmin: boolean,
    ciudadesNormalizadas?: {
      fila: number;
      origen?: string | null;
      destino?: string | null;
    }[],
    filasExcluidas?: number[],
  ) {
    await this.assertImportacionesVisible(tenantId, isSuperadmin);
    const session = await this.prisma.importSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { template: { select: { modulo: true } } },
    });

    if (!session)
      throw new NotFoundException("Sesión de importación no encontrada");
    if (session.expiresAt < new Date()) {
      await this.prisma.importSession.delete({ where: { id: sessionId } });
      throw new GoneException(
        "La sesión expiró. Volvé a subir el archivo para generar una nueva previsualización",
      );
    }

    const processor = this.processors[session.template.modulo];
    if (!processor) {
      throw new BadRequestException(
        `No hay processor para el módulo "${session.template.modulo}"`,
      );
    }

    const todasLasFilas = session.filasValidas as unknown as ValidatedRow[];

    // Filas que el usuario decidió no importar (ej. destino multidestino que
    // nunca va a resolver a una sola ciudad) — no se procesan ni se cuentan
    // como error, quedan registradas aparte en el log.
    const excluidas = new Set(filasExcluidas ?? []);
    const filasValidas = todasLasFilas.filter(
      (f) => !excluidas.has(f._rowNum),
    );
    const detallesOmitidas = todasLasFilas
      .filter((f) => excluidas.has(f._rowNum))
      .map((f) => ({
        fila: f._rowNum,
        estado: "omitida",
        mensaje: "Fila omitida por el usuario antes de confirmar.",
      }));

    if (ciudadesNormalizadas?.length) {
      const byFila = new Map(ciudadesNormalizadas.map((c) => [c.fila, c]));
      for (const fila of filasValidas) {
        const patch = byFila.get(fila._rowNum);
        if (!patch) continue;
        if (patch.origen !== undefined) fila.origen = patch.origen;
        if (patch.destino !== undefined) fila.destino = patch.destino;
      }
    }

    for (const fila of filasValidas) {
      for (const key of Object.keys(fila)) {
        const value = fila[key];
        if (typeof value === "string" && value.startsWith("__pending__")) {
          const [, , model, nombre] = value.split("__");
          const id = await this.validator.createLookup(
            model,
            "nombre",
            nombre,
            tenantId,
          );
          // Antes: si createLookup devolvía null, se asignaba null en silencio
          // y el dato se descartaba sin que nadie se enterara. Ahora corta.
          if (!id) {
            throw new BadRequestException(
              `No se pudo crear "${nombre}" en "${model}". Revisá la configuración de la importación.`,
            );
          }
          fila[key] = id;
        }
      }
    }

    const detalles: object[] = [...detallesOmitidas];
    let exitosas = 0;
    let errores = 0;

    for (const fila of filasValidas) {
      try {
        const id = await processor.insert(fila, tenantId, createdBy);
        detalles.push({ fila: fila._rowNum, estado: "ok", id });
        exitosas++;
      } catch (err: unknown) {
        const mensaje = err instanceof Error ? err.message : "Error inesperado";
        detalles.push({ fila: fila._rowNum, estado: "error", mensaje });
        errores++;
      }
    }

    const estado =
      errores === 0 ? "completado" : exitosas === 0 ? "fallido" : "con_errores";

    const log = await this.prisma.importLog.create({
      data: {
        tenantId,
        templateId: session.templateId,
        modulo: session.template.modulo,
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
      orderBy: { createdAt: "desc" },
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
    if (!log) throw new NotFoundException("Log de importación no encontrado");
    return log;
  }

  // ── Templates (admin) ─────────────────────────────────────────────────────

  createTemplate(dto: CreateTemplateDto) {
    return this.prisma.importTemplate.upsert({
      where: {
        tenantId_modulo: { tenantId: dto.tenantId, modulo: dto.modulo },
      },
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
      orderBy: { modulo: "asc" },
      select: {
        id: true,
        modulo: true,
        nombre: true,
        activo: true,
        config: true,
        updatedAt: true,
      },
    });
  }

  /** Catálogo fijo de campos importables de un módulo — fuente de verdad para la UI de configuración de templates. */
  getCatalogoCampos(modulo: string) {
    return TEMPLATE_CATALOGO[modulo] ?? [];
  }

  /**
   * Sugerencia de mapeo con IA a partir de un Excel de ejemplo — nunca
   * guarda nada, el superadmin la revisa en el formulario antes de guardar.
   */
  async sugerirTemplate(
    modulo: string,
    buffer: Buffer,
  ): Promise<SugerenciaTemplate> {
    const catalogo = this.getCatalogoCampos(modulo);
    if (catalogo.length === 0) {
      throw new BadRequestException(
        `No hay catálogo de campos definido para el módulo "${modulo}".`,
      );
    }
    const { headers, sampleRows } = this.parser.sample(buffer);
    if (headers.length === 0) {
      throw new BadRequestException(
        "No se encontraron encabezados en la primera fila del archivo.",
      );
    }
    return this.iaTemplateSuggestion.sugerir(catalogo, headers, sampleRows);
  }

  /**
   * Agrupa los errores de lookup ("no encontrado") por modelo y valor
   * distinto, para poder ofrecer "crear estos N faltantes" en vez de que el
   * superadmin tenga que leer fila por fila. Para vehículos, sugiere un tipo
   * a partir de la posición dentro del par tractor/semirremolque — es una
   * regla fija (no IA): si un valor SIEMPRE apareció en la posición 0,
   * probablemente sea el tractor/chasis; si siempre en la 1, el
   * semirremolque. Si aparece mezclado, no se sugiere nada y lo completa el
   * usuario.
   */
  private agruparEntidadesFaltantes(errors: RowError[]): EntidadesFaltantesModelo[] {
    const porModelo = new Map<string, Map<string, Set<number>>>();

    for (const e of errors) {
      if (!e.lookupModel || !e.valoresNoEncontrados) continue;
      const porValor = porModelo.get(e.lookupModel) ?? new Map<string, Set<number>>();
      for (const { valor, posicion } of e.valoresNoEncontrados) {
        const posiciones = porValor.get(valor) ?? new Set<number>();
        posiciones.add(posicion);
        porValor.set(valor, posiciones);
      }
      porModelo.set(e.lookupModel, porValor);
    }

    return [...porModelo.entries()].map(([modelo, porValor]) => ({
      modelo,
      valores: [...porValor.entries()].map(([valor, posiciones]) => ({
        valor,
        tipoSugerido: this.sugerirTipoVehiculo(modelo, posiciones),
      })),
    }));
  }

  private sugerirTipoVehiculo(modelo: string, posiciones: Set<number>): string | null {
    if (modelo !== "vehiculos") return null;
    if (posiciones.size !== 1) return null; // apareció en más de una posición: ambiguo
    const [posicion] = posiciones;
    if (posicion === 0) return "tractor";
    if (posicion === 1) return "semirremolque";
    return null;
  }

  /**
   * Crea los vehículos faltantes que el superadmin confirmó desde el panel
   * de previsualización — mismo `VehiculosService.create()` que usa el alta
   * manual, sin bypassear ninguna validación.
   */
  async crearVehiculosFaltantes(
    tenantId: string,
    items: { patente: string; tipo: string }[],
  ): Promise<{ creados: number; errores: { patente: string; error: string }[] }> {
    let creados = 0;
    const errores: { patente: string; error: string }[] = [];
    for (const item of items) {
      try {
        await this.vehiculosService.create(tenantId, {
          patente: item.patente,
          tipo: item.tipo,
        });
        creados++;
      } catch (e) {
        errores.push({
          patente: item.patente,
          error: e instanceof Error ? e.message : "Error desconocido",
        });
      }
    }
    return { creados, errores };
  }

  /**
   * Crea entidades faltantes que solo necesitan un nombre (clientes,
   * transportistas, choferes, productos) — confirmadas por el superadmin
   * desde el mismo panel de previsualización. Reutiliza `createLookup`, el
   * mismo alta mínima que ya usa "crear si no existe" durante el import, así
   * que no hay dos caminos de creación distintos.
   */
  async crearEntidadesFaltantesSimple(
    tenantId: string,
    modelo: string,
    valores: string[],
  ): Promise<{ creados: number; errores: { valor: string; error: string }[] }> {
    let creados = 0;
    const errores: { valor: string; error: string }[] = [];
    for (const valor of valores) {
      try {
        const id = await this.validator.createLookup(modelo, "nombre", valor, tenantId);
        if (id) creados++;
        else errores.push({ valor, error: "No se pudo crear." });
      } catch (e) {
        errores.push({
          valor,
          error: e instanceof Error ? e.message : "Error desconocido",
        });
      }
    }
    return { creados, errores };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildViajesPreview(
    parsed: ParsedRow[],
    valid: ValidatedRow[],
    created: {
      clientes: string[];
      transportistas: string[];
      choferes: string[];
    },
  ): {
    viajes: PreviewViaje[];
    facturas: PreviewFactura[];
    clientes: PreviewEntidad[];
    transportistas: PreviewEntidad[];
  } {
    const parsedByRow = new Map(parsed.map((r) => [r._rowNum, r]));
    const newClienteNames = new Set(
      created.clientes.map((n) => n.toLowerCase()),
    );
    const newTransportistaNames = new Set(
      created.transportistas.map((n) => n.toLowerCase()),
    );

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
      if (v instanceof Date) return v.toLocaleDateString("es-AR");
      return toStr(v);
    };

    for (const validRow of valid) {
      const p = parsedByRow.get(validRow._rowNum);
      if (!p) continue;

      const cliente = toStr(p.clienteId) ?? "";
      const transporte = toStr(p.transportistaId);
      if (cliente) clienteNamesSet.add(cliente);
      if (transporte) transportistaNamesSet.add(transporte);

      const monto = toNum(p.monto);
      const precioTransp = toNum(p.precioTransportistaExterno);
      const nroFactura = toStr(p.nroFactura);

      viajes.push({
        fila: validRow._rowNum,
        cliente,
        transporte,
        chofer: toStr(p.choferId),
        vehiculo: toStr(p.vehiculoId),
        origen: toStr(p.origen),
        destino: toStr(p.destino),
        fechaCarga: toDateStr(p.fechaCarga),
        fechaDescarga: toDateStr(p.fechaDescarga),
        detalleCarga: toStr(p.detalleCarga),
        monto,
        monedaMonto: toStr(validRow.monedaMonto),
        nroFactura,
        precioTransportistaExterno: precioTransp,
        monedaPrecioTransportistaExterno: toStr(
          validRow.monedaPrecioTransportistaExterno,
        ),
      });

      // Las facturas de este preview son siempre a cliente — el pago al
      // transportista (precioTransportistaExterno) se liquida por afuera,
      // vía Liquidaciones (post-viajes), no como una Factura propia.
      if (nroFactura) {
        facturas.push({
          tipo: "cliente",
          numero: nroFactura,
          nombre: cliente || null,
          importe: monto ?? 0,
          fechaEmision: toDateStr(p.fechaEmisionFactura),
          fechaVencimiento: toDateStr(p.fechaVencimientoFactura),
        });
      }
    }

    return {
      viajes,
      facturas,
      clientes: [...clienteNamesSet].map((nombre) => ({
        nombre,
        esNuevo: newClienteNames.has(nombre.toLowerCase()),
      })),
      transportistas: [...transportistaNamesSet].map((nombre) => ({
        nombre,
        esNuevo: newTransportistaNames.has(nombre.toLowerCase()),
      })),
    };
  }

  private async getActiveTemplate(tenantId: string, modulo: string) {
    const template = await this.prisma.importTemplate.findFirst({
      where: { tenantId, modulo, activo: true },
    });
    if (template) return template;

    // Sin template propio todavía: se genera uno por defecto a partir del
    // catálogo fijo (mismos encabezados sugeridos que ve el superadmin), para
    // que ningún módulo quede bloqueado por falta de configuración. Queda
    // guardado como un ImportTemplate real, editable después desde la pestaña
    // Templates igual que cualquier otro.
    const config = construirConfigPorDefecto(modulo);
    if (!config) {
      throw new NotFoundException(
        `No hay template activo de importación para el módulo "${modulo}". Contactá a soporte.`,
      );
    }
    return this.prisma.importTemplate.upsert({
      where: { tenantId_modulo: { tenantId, modulo } },
      create: {
        tenantId,
        modulo,
        nombre: `Template ${modulo} (por defecto)`,
        config: config as unknown as object,
        activo: true,
      },
      update: {},
    });
  }
}
