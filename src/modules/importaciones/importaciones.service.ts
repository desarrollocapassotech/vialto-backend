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
import type { ViajeActual } from "./processors/viajes.processor";
import { ClientesProcessor } from "./processors/clientes.processor";
import { TransportistasProcessor } from "./processors/transportistas.processor";
import { ChoferesProcessor } from "./processors/choferes.processor";
import { VehiculosProcessor } from "./processors/vehiculos.processor";
import type { IImportProcessor } from "./processors/import-processor.interface";
import type {
  TemplateConfig,
  ColumnConfig,
  ValidatedRow,
  ParsedRow,
  PreviewResult,
  PreviewViaje,
  PreviewCambioCampo,
  PreviewFactura,
  PreviewEntidad,
  RowError,
  EntidadesFaltantesModelo,
  ColumnaEsperada,
  ColumnasEsperadasModulo,
} from "./types/import.types";
import type { CreateTemplateDto } from "./dto/create-template.dto";
import { getCatalogoColumnas, getAltaFormularioDeModulo, construirConfigPorDefecto } from "./template-catalogo";
import { IaTemplateSuggestionService, type SugerenciaTemplate } from "./ia-template-suggestion.service";
import { VehiculosService } from "../../core/vehiculos/vehiculos.service";
import { TenantFieldConfigService } from "../../core/tenant-field-config/tenant-field-config.service";

/** Nombre de hoja sugerido cuando el template (propio o default) no trae uno explícito — mismo criterio que `sheetDefault` en template-catalogo.ts. */
const SHEET_LABEL_DEFAULT: Record<string, string> = {
  clientes: "Clientes",
  transportistas: "Transportes",
  choferes: "Choferes",
  vehiculos: "Vehículos",
  viajes: "Viajes",
};

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
    private readonly tenantFieldConfig: TenantFieldConfigService,
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

  /**
   * Si el tenant ya tiene algún cliente/transportista/chofer/vehículo
   * cargado, el wizard le ofrece elegir qué módulos importar en vez de
   * forzar la secuencia completa de siempre (pensada para altas nuevas).
   */
  async tenantTieneDatos(tenantId: string): Promise<{
    clientes: boolean;
    transportistas: boolean;
    choferes: boolean;
    vehiculos: boolean;
  }> {
    const [clientes, transportistas, choferes, vehiculos] = await Promise.all([
      this.prisma.cliente.count({ where: { tenantId } }),
      this.prisma.transportista.count({ where: { tenantId } }),
      this.prisma.chofer.count({ where: { tenantId } }),
      this.prisma.vehiculo.count({ where: { tenantId } }),
    ]);
    return {
      clientes: clientes > 0,
      transportistas: transportistas > 0,
      choferes: choferes > 0,
      vehiculos: vehiculos > 0,
    };
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

    const { valid, errors, advertencias, created } = await this.validator.validate(
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
          (c) =>
            c.excelHeader.toLowerCase() === h.toLowerCase() ||
            c.excelHeaderAliases?.some((a) => a.toLowerCase() === h.toLowerCase()),
        ),
    );
    const columnasOpcionalesFaltantes = config.columns
      .filter(
        (c) =>
          !c.required &&
          !headersExcelLower.has(c.excelHeader.toLowerCase()) &&
          !(c.excelHeaderAliases?.some((a) => headersExcelLower.has(a.toLowerCase()))),
      )
      .map((c) => c.excelHeader);

    const entidadesFaltantes = this.agruparEntidadesFaltantes(errors);

    // Desglose altas/actualizaciones — solo para módulos cuyo processor lo
    // soporta (todos: Clientes/Transportistas/Choferes/Vehículos por
    // nombre/patente, Viajes por ID Personalizado o el mismo fallback
    // compuesto que usa `findExisting` al confirmar).
    const processorModulo = this.processors[modulo];
    let entidadesNuevas: number | undefined;
    let entidadesActualizadas: number | undefined;
    if (processorModulo?.contarExistentes) {
      entidadesActualizadas = await processorModulo.contarExistentes(
        valid,
        tenantId,
      );
      entidadesNuevas = valid.length - entidadesActualizadas;
    }

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
      advertenciasCamposFaltantes: advertencias,
      entidadesNuevas,
      entidadesActualizadas,
    };

    if (processorModulo?.detectarCampoUnicoDuplicado) {
      result.advertenciasCampoUnicoDuplicado =
        await processorModulo.detectarCampoUnicoDuplicado(valid, tenantId);
    }

    if (modulo === "viajes") {
      Object.assign(
        result,
        await this.buildViajesPreview(parsed, valid, created, tenantId),
      );
      result.advertenciasFacturasDuplicadas =
        await this.viajesProcessor.detectarFacturasDuplicadas(valid, tenantId);
    } else if (processorModulo?.filasNuevas) {
      const nuevas = await processorModulo.filasNuevas(valid, tenantId);
      const parsedByRow = new Map(parsed.map((r) => [r._rowNum, r]));
      // `raw[c.field]` viene de ParserService.parse(), que para columnas de
      // fecha ya convierte la celda a un objeto Date real (ver
      // normalizeExcelDate en parser.service.ts) — stringificarlo con
      // `String()` a secas usa el formato nativo de JS ("Sat May 10 2025
      // 03:00:00 GMT+0000...") en vez de una fecha legible. Bug real
      // encontrado en QA: todas las columnas de fecha del detalle de
      // filas (Choferes, Vehículos, Transportistas) mostraban ese texto.
      const valorLegible = (v: unknown): string =>
        v instanceof Date ? v.toLocaleDateString("es-AR") : String(v).trim();
      result.filasDetalle = valid.map((v) => {
        const raw = parsedByRow.get(v._rowNum);
        const campos = config.columns
          .filter(
            (c) =>
              raw &&
              raw[c.field] != null &&
              String(raw[c.field]).trim() !== "",
          )
          .map((c) => ({
            campo: c.field,
            label: c.excelHeader,
            valor: valorLegible(raw![c.field]),
          }));
        return { fila: v._rowNum, esNuevo: nuevas.has(v._rowNum), campos };
      });
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
    confirmarCamposFaltantes?: boolean,
    confirmarFacturasDuplicadas?: boolean,
    decisionesCampoUnicoDuplicado?: { fila: number; accion: "ignorar" | "actualizar" }[],
  ) {
    await this.assertImportacionesVisible(tenantId, isSuperadmin);
    const session = await this.prisma.importSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { template: { select: { modulo: true, config: true } } },
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

    // Clientes/Transportistas (ID Fiscal), Choferes (DNI): filas cuyo campo
    // único ya pertenece a OTRA entidad existente — el usuario elige por
    // fila "ignorar" (se suma a `excluidas`, mismo camino que una exclusión
    // manual) o "actualizar" (se guarda el id de la entidad existente para
    // que el processor la pise en vez de crear una nueva o chocar). Se
    // recalcula acá en vivo, no se reusa el preview, porque la base puede
    // haber cambiado desde entonces — mismo criterio que
    // `detectarFacturasDuplicadas` en Viajes más abajo.
    const actualizarEntidadPorFila = new Map<number, string>();
    let campoLabelConflicto = "campo único";
    if (processor.detectarCampoUnicoDuplicado) {
      const candidatas = todasLasFilas.filter((f) => !excluidas.has(f._rowNum));
      const conflictos = await processor.detectarCampoUnicoDuplicado(
        candidatas,
        tenantId,
      );
      if (conflictos.length > 0) {
        campoLabelConflicto = [
          ...new Set(conflictos.map((c) => c.campoLabel)),
        ].join("/");
        const decididas = new Map(
          (decisionesCampoUnicoDuplicado ?? []).map((d) => [d.fila, d.accion]),
        );
        const sinResolver = conflictos.filter((c) => !decididas.has(c.fila));
        if (sinResolver.length > 0) {
          throw new BadRequestException(
            `Hay ${sinResolver.length} fila(s) cuyo ${campoLabelConflicto} ya pertenece a otro registro — elegí "ignorar" o "actualizar" para cada una antes de confirmar.`,
          );
        }
        for (const c of conflictos) {
          if (decididas.get(c.fila) === "ignorar") {
            excluidas.add(c.fila);
          } else {
            actualizarEntidadPorFila.set(c.fila, c.entidadExistenteId);
          }
        }
      }
    }

    const filasValidas = todasLasFilas.filter(
      (f) => !excluidas.has(f._rowNum),
    );
    const detallesOmitidas = todasLasFilas
      .filter((f) => excluidas.has(f._rowNum))
      .map((f) => ({
        fila: f._rowNum,
        estado: "omitida",
        mensaje: filasExcluidas?.includes(f._rowNum)
          ? "Fila omitida por el usuario antes de confirmar."
          : `Fila omitida: el ${campoLabelConflicto} ya pertenece a otro registro.`,
      }));

    for (const fila of filasValidas) {
      const entidadExistenteId = actualizarEntidadPorFila.get(fila._rowNum);
      if (entidadExistenteId) fila._duplicadoEntidadId = entidadExistenteId;
    }

    // Campos "recomendados pero no bloqueantes" (ej. CUIT/país de cliente):
    // si alguna fila a importar los tiene vacíos, el usuario tiene que
    // confirmarlo explícitamente — si no, no dejamos pasar el confirm
    // (re-chequeo defensivo: la advertencia ya se mostró en el preview).
    const columnasAdvertencia = (
      session.template.config as unknown as TemplateConfig
    ).columns.filter((c) => c.warnIfEmpty);
    if (columnasAdvertencia.length > 0 && !confirmarCamposFaltantes) {
      const faltan = filasValidas.some((f) =>
        columnasAdvertencia.some(
          (c) => f[c.field] == null || String(f[c.field]).trim() === "",
        ),
      );
      if (faltan) {
        throw new BadRequestException(
          "Hay filas sin " +
          columnasAdvertencia.map((c) => c.excelHeader).join("/") +
          " — confirmá que querés importarlas igual.",
        );
      }
    }

    // Viajes: si varios viajes nuevos van a compartir número de factura (o
    // ese número ya existe de otro import), confirm() los reutiliza y suma
    // el importe en vez de duplicarlos — pero necesita confirmación
    // explícita antes, mismo criterio que los campos recomendados.
    if (session.template.modulo === "viajes" && !confirmarFacturasDuplicadas) {
      const duplicadas = await this.viajesProcessor.detectarFacturasDuplicadas(
        filasValidas,
        tenantId,
      );
      if (duplicadas.length > 0) {
        throw new BadRequestException(
          "Hay números de factura repetidos entre varios viajes nuevos (" +
          duplicadas.map((d) => d.numero).join(", ") +
          ") — confirmá que querés unificarlos en una sola factura.",
        );
      }
    }

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
        const { id, creado, facturado } = await processor.insert(
          fila,
          tenantId,
          createdBy,
        );
        detalles.push({ fila: fila._rowNum, estado: "ok", id, creado, facturado });
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

  /**
   * Catálogo de campos importables de un módulo — se arma desde Prisma +
   * overlays, y se filtra con los campos que el tenant tiene visibles en su
   * formulario de alta correspondiente (`tenant-field-config`). Módulos sin
   * contraparte ahí (ej. `choferes`) no se filtran — se muestran todos.
   */
  async getCatalogoCampos(modulo: string, tenantId: string) {
    const columnas = getCatalogoColumnas(modulo);
    const altaFormulario = getAltaFormularioDeModulo(modulo);
    if (!altaFormulario) return columnas;

    const config = await this.tenantFieldConfig.getConfigEfectiva(
      tenantId,
      altaFormulario.modulo,
      altaFormulario.formulario,
    );
    const ocultos = new Set(config.filter((c) => !c.visible).map((c) => c.campo));
    return columnas.filter((c) => !ocultos.has(c.field));
  }

  /**
   * Columnas que el importador va a esperar de cada módulo si el tenant
   * sube un Excel ahora mismo — usa el template propio si ya configuró uno
   * (`ImportTemplate` activo), o el default si no. A diferencia de
   * `getActiveTemplate()` (usada por `preview()`), esta consulta es de solo
   * lectura: no crea ningún `ImportTemplate` — se llama antes de que el
   * usuario suba nada, no tiene sentido dejar filas de más en la tabla por
   * módulos que capaz nunca termine importando.
   */
  async getColumnasEsperadas(tenantId: string): Promise<ColumnasEsperadasModulo[]> {
    const modulos = ["clientes", "transportistas", "choferes", "vehiculos", "viajes"];
    const templates = await this.prisma.importTemplate.findMany({
      where: { tenantId, modulo: { in: modulos }, activo: true },
    });
    const templatePorModulo = new Map(templates.map((t) => [t.modulo, t]));

    return modulos.map((modulo) => {
      const template = templatePorModulo.get(modulo);
      const config = template
        ? (template.config as unknown as TemplateConfig)
        : construirConfigPorDefecto(modulo);
      const catalogo = getCatalogoColumnas(modulo);

      const columnas: ColumnaEsperada[] = (config?.columns ?? []).map((c) => {
        const enCatalogo = catalogo.find((cat) => cat.field === c.field);
        const col: ColumnaEsperada = {
          excelHeader: c.excelHeader,
          campoLabel: enCatalogo?.campoLabel ?? c.field,
          tipo: c.type,
          requerido: !!c.required,
        };
        if (c.warnIfEmpty) col.recomendado = true;
        if (c.allowedValues) col.allowedValues = c.allowedValues;
        if (c.lookupModel) col.lookupModel = c.lookupModel;
        return col;
      });

      return {
        modulo,
        sheet:
          (typeof config?.sheet === "string" ? config.sheet : undefined) ??
          SHEET_LABEL_DEFAULT[modulo] ??
          modulo,
        columnas,
      };
    });
  }

  /**
   * Sugerencia de mapeo con IA a partir de un Excel de ejemplo — nunca
   * guarda nada, el superadmin la revisa en el formulario antes de guardar.
   */
  async sugerirTemplate(
    modulo: string,
    buffer: Buffer,
  ): Promise<SugerenciaTemplate> {
    const catalogo = getCatalogoColumnas(modulo);
    if (catalogo.length === 0) {
      throw new BadRequestException(
        `No hay catálogo de campos definido para el módulo "${modulo}".`,
      );
    }
    const hojas = this.parser.sampleWorkbook(buffer);
    if (hojas.length === 0 || hojas.every((h) => h.filas.length === 0)) {
      throw new BadRequestException("El archivo no tiene datos para analizar.");
    }
    return this.iaTemplateSuggestion.sugerir(catalogo, hojas);
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

  /**
   * Nombres reales de Cliente/Transportista/Chofer para los ids ya resueltos
   * por el lookup (`ValidatedRow.clienteId`/`transportistaId`/`choferId`) —
   * usado por `buildViajesPreview` para mostrar el NOMBRE en el preview en
   * vez del texto crudo de la celda (que puede ser un CUIT/DNI, ver
   * `nombreLookupResuelto`). Ids `__pending__...` (entidad que se va a crear
   * recién al confirmar) se resuelven aparte, no llegan a esta consulta.
   */
  private async resolverNombresLookup(
    valid: ValidatedRow[],
    tenantId: string,
  ): Promise<{
    clientes: Map<string, string>;
    transportistas: Map<string, string>;
    choferes: Map<string, string>;
  }> {
    const esIdReal = (v: unknown): v is string =>
      typeof v === "string" && v !== "" && !v.startsWith("__pending__");

    const idsClientes = new Set<string>();
    const idsTransportistas = new Set<string>();
    const idsChoferes = new Set<string>();
    for (const row of valid) {
      if (esIdReal(row.clienteId)) idsClientes.add(row.clienteId);
      if (esIdReal(row.transportistaId)) idsTransportistas.add(row.transportistaId);
      if (esIdReal(row.transportistaEfectivoId))
        idsTransportistas.add(row.transportistaEfectivoId as string);
      if (esIdReal(row.choferId)) idsChoferes.add(row.choferId);
    }

    const [clientesRows, transportistasRows, choferesRows] = await Promise.all([
      idsClientes.size > 0
        ? this.prisma.cliente.findMany({
          where: { tenantId, id: { in: [...idsClientes] } },
          select: { id: true, nombre: true },
        })
        : Promise.resolve([]),
      idsTransportistas.size > 0
        ? this.prisma.transportista.findMany({
          where: { tenantId, id: { in: [...idsTransportistas] } },
          select: { id: true, nombre: true },
        })
        : Promise.resolve([]),
      idsChoferes.size > 0
        ? this.prisma.chofer.findMany({
          where: { tenantId, id: { in: [...idsChoferes] } },
          select: { id: true, nombre: true },
        })
        : Promise.resolve([]),
    ]);

    return {
      clientes: new Map(clientesRows.map((c) => [c.id, c.nombre])),
      transportistas: new Map(transportistasRows.map((t) => [t.id, t.nombre])),
      choferes: new Map(choferesRows.map((c) => [c.id, c.nombre])),
    };
  }

  /** Resuelve el id de un lookup (o placeholder `__pending__<modelo>__<original>` de una entidad a crear) a su nombre para mostrar. */
  private nombreLookupResuelto(
    valor: unknown,
    nombresPorId: Map<string, string>,
  ): string | null {
    if (valor == null || typeof valor !== "string" || valor === "") return null;
    if (valor.startsWith("__pending__")) {
      const resto = valor.slice("__pending__".length);
      const idx = resto.indexOf("__");
      return (idx >= 0 ? resto.slice(idx + 2) : resto) || null;
    }
    return nombresPorId.get(valor) ?? null;
  }

  private async buildViajesPreview(
    parsed: ParsedRow[],
    valid: ValidatedRow[],
    created: {
      clientes: string[];
      transportistas: string[];
      choferes: string[];
    },
    tenantId: string,
  ): Promise<{
    viajes: PreviewViaje[];
    facturas: PreviewFactura[];
    clientes: PreviewEntidad[];
    transportistas: PreviewEntidad[];
  }> {
    const estadoActual = await this.viajesProcessor.obtenerEstadoActual(
      valid,
      tenantId,
    );
    const nombresLookup = await this.resolverNombresLookup(valid, tenantId);
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

    const toDateStr = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toLocaleDateString("es-AR");
      return toStr(v);
    };

    for (const validRow of valid) {
      const p = parsedByRow.get(validRow._rowNum);
      if (!p) continue;

      // Cliente/Transporte/Chofer se muestran por su NOMBRE resuelto (el que
      // realmente matcheó el lookup), no el texto crudo de la celda — algunos
      // tenants (ej. NyM) tipean el CUIT/DNI ahí en vez del nombre (ver
      // LOOKUP_CLIENTE_VIAJE/LOOKUP_TRANSPORTISTA_VIAJE/LOOKUP_CHOFER en
      // template-catalogo.ts), y mostrar la celda cruda comparaba "Nombre
      // actual → CUIT" en el diff, como si el nombre hubiera cambiado a un
      // número. Bug real reportado por el usuario, ago 2026.
      const cliente =
        this.nombreLookupResuelto(validRow.clienteId, nombresLookup.clientes) ??
        "";
      const transporte = this.nombreLookupResuelto(
        validRow.transportistaId,
        nombresLookup.transportistas,
      );
      if (cliente) clienteNamesSet.add(cliente);
      if (transporte) transportistaNamesSet.add(transporte);

      // Igual que Cliente/Transporte/Chofer: se muestra el valor REALMENTE
      // calculado (mismo método que usa el processor al guardar), no la
      // celda cruda de "Monto"/"Flete" — con templates de desglose
      // (cantidadFactura × precioUnitarioFactura, o su equivalente del
      // transportista) esas columnas ni existen en el Excel, así que leerlas
      // crudas mostraba "— " como si el import fuera a borrar el monto de un
      // viaje existente. Bug real reportado por el usuario, ago 2026.
      const monto = this.viajesProcessor.resolveMonto(validRow);
      const precioTransp =
        this.viajesProcessor.resolvePrecioTransportistaExterno(validRow);
      const nroFactura = toStr(p.nroFactura);

      const nuevoValor = {
        cliente,
        transporte,
        chofer: this.nombreLookupResuelto(
          validRow.choferId,
          nombresLookup.choferes,
        ),
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
      };

      const actual = estadoActual.get(validRow._rowNum);
      const cambios = actual
        ? this.compararCamposViaje(actual, nuevoValor, toDateStr)
        : undefined;

      viajes.push({
        fila: validRow._rowNum,
        ...nuevoValor,
        nuevo: !actual,
        cambios,
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

  /** Compara el estado actual de un viaje (antes de este import) contra los valores nuevos, campo por campo — solo devuelve los que cambian. */
  private compararCamposViaje(
    actual: ViajeActual,
    nuevo: {
      cliente: string;
      transporte: string | null;
      chofer: string | null;
      vehiculo: string | null;
      origen: string | null;
      destino: string | null;
      fechaCarga: string | null;
      fechaDescarga: string | null;
      detalleCarga: string | null;
      monto: number | null;
      monedaMonto: string | null;
      nroFactura: string | null;
      precioTransportistaExterno: number | null;
      monedaPrecioTransportistaExterno: string | null;
    },
    toDateStr: (v: unknown) => string | null,
  ): PreviewCambioCampo[] {
    const pares: PreviewCambioCampo[] = [
      { campo: "Cliente", antes: actual.cliente, despues: nuevo.cliente || null },
      { campo: "Transporte", antes: actual.transporte, despues: nuevo.transporte },
      { campo: "Chofer", antes: actual.chofer, despues: nuevo.chofer },
      { campo: "Vehículo", antes: actual.vehiculo, despues: nuevo.vehiculo },
      { campo: "Origen", antes: actual.origen, despues: nuevo.origen },
      { campo: "Destino", antes: actual.destino, despues: nuevo.destino },
      {
        campo: "F. Carga",
        antes: toDateStr(actual.fechaCarga),
        despues: nuevo.fechaCarga,
      },
      {
        campo: "F. Descarga",
        antes: toDateStr(actual.fechaDescarga),
        despues: nuevo.fechaDescarga,
      },
      { campo: "Carga", antes: actual.detalleCarga, despues: nuevo.detalleCarga },
      { campo: "Monto", antes: actual.monto, despues: nuevo.monto },
      { campo: "Moneda", antes: actual.monedaMonto, despues: nuevo.monedaMonto },
      { campo: "Nro FC", antes: actual.nroFactura, despues: nuevo.nroFactura },
      {
        campo: "Flete",
        antes: actual.precioTransportistaExterno,
        despues: nuevo.precioTransportistaExterno,
      },
      {
        campo: "Moneda Flete",
        antes: actual.monedaPrecioTransportistaExterno,
        despues: nuevo.monedaPrecioTransportistaExterno,
      },
    ];
    return pares.filter((p) => p.antes !== p.despues);
  }

  private async getActiveTemplate(tenantId: string, modulo: string) {
    let template = await this.prisma.importTemplate.findFirst({
      where: { tenantId, modulo, activo: true },
    });

    if (!template) {
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
      template = await this.prisma.importTemplate.upsert({
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

    // Inyectar columnas faltantes y alias desde el catálogo en tiempo de ejecución
    const configData = template.config as unknown as TemplateConfig;
    if (configData && configData.columns) {
      const catalogo = getCatalogoColumnas(modulo);

      // 1. Inyectar columnas que falten en la BD pero existan en el catálogo actual
      for (const catCol of catalogo) {
        if (!configData.columns.some((c) => c.field === catCol.field)) {
          const nueva: ColumnConfig = {
            field: catCol.field,
            excelHeader: catCol.defaultExcelHeader,
            excelHeaderAliases: catCol.excelHeaderAliases,
            type: catCol.type,
            required: catCol.systemRequired,
          };
          // Bug real (QA, ago 2026): esto solo copiaba los 5 campos de
          // arriba — una columna "enum" inyectada así (ej. tipoFlota) queda
          // sin `allowedValues`, y el validador rechaza cualquier valor con
          // "Los valores permitidos son: undefined" para las 5 filas. Faltaba
          // copiar el resto de las propiedades que definen cómo se valida la
          // columna, no solo su nombre/tipo.
          if (catCol.allowedValues) nueva.allowedValues = catCol.allowedValues;
          if (catCol.format) nueva.format = catCol.format;
          if (catCol.warnIfEmpty) nueva.warnIfEmpty = true;
          if (catCol.type === "lookup") {
            nueva.lookupModel = catCol.lookupModel;
            if (catCol.lookupFields) nueva.lookupFields = catCol.lookupFields;
            if (catCol.multiple) {
              nueva.multiple = true;
              nueva.separador = catCol.separador ?? "/";
            }
          }
          configData.columns.push(nueva);
        }
      }

      // 2. Inyectar alias a las columnas existentes (en caso de que hayan sido actualizadas en el código)
      for (const col of configData.columns) {
        const catCol = catalogo.find((c) => c.field === col.field);
        if (
          catCol?.excelHeaderAliases &&
          (!col.excelHeaderAliases || col.excelHeaderAliases.length === 0)
        ) {
          col.excelHeaderAliases = catCol.excelHeaderAliases;
        }
      }
    }

    return template;
  }
}
