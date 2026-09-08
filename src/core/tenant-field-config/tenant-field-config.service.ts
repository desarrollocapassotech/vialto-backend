import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  getCatalogoFormulario,
  getCatalogoModulo,
  FIELD_CATALOG,
  type CampoCatalogo,
} from "./field-catalog";
import { ToggleFieldConfigDto } from "./dto/toggle-field-config.dto";

type FieldConfigValue = { visible: boolean };
type CamposJson = Record<string, FieldConfigValue>;

// Nombre de clave legado (nació solo para viajes) — el valor no cambia para no
// romper la config ya guardada de tenants existentes, pero desde sep 2026 aplica
// a todo módulo de `MODULOS_CAMPOS_COMPARTIDOS`, no solo a viajes.
const VIAJES_CONFIG_COMPARTIDA = "viajes_compartidos";

/**
 * Módulos cuyos "formularios" son etapas del mismo registro (alta/edición/detalle
 * de una misma entidad) — la visibilidad de un campo se comparte entre las tres,
 * sin selector de formulario en la pantalla de superadmin. `stock` queda afuera
 * a propósito: sus 3 formularios (alta_ingreso/alta_egreso/division_bultos) son
 * operaciones distintas, no etapas de un mismo registro — compartir su config
 * mezclaría configuraciones de pantallas que no tienen nada que ver entre sí.
 */
const MODULOS_CAMPOS_COMPARTIDOS = new Set([
  "viajes",
  "clientes",
  "transportistas",
  "vehiculos",
]);

@Injectable()
export class TenantFieldConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Obtiene la configuración de un formulario combinando el catálogo base con la configuración del tenant. */
  async getConfigEfectiva(
    tenantId: string,
    modulo: string,
    formulario: string,
  ) {
    const catalogo = getCatalogoFormulario(modulo, formulario);
    const overrides = await this.getOverrides(tenantId, modulo, formulario);

    return catalogo.map((c) => ({
      campo: c.campo,
      label: c.label,
      obligatorioSistema: c.obligatorioSistema,
      visible: overrides[c.campo]?.visible ?? c.defaultVisible ?? true,
    }));
  }

  /**
   * Igual que `getConfigEfectiva`, pero para la pantalla de superadmin de un
   * módulo con `esCampoCompartido`: devuelve la UNIÓN deduplicada de campos de
   * TODOS los formularios del módulo (alta/edición/detalle), en vez de solo uno
   * — así un campo que solo existe en detalle (ej. "Km. Actual" de Vehículos) o
   * solo en edición (ej. "Estado (Activo)") sigue siendo togglable aunque no
   * haya selector de formulario visible. Usa el mismo `getOverrides` que ya
   * devuelve la visibilidad compartida sobre el union de `catalogFields`.
   */
  async getConfigEfectivaModuloUnificado(tenantId: string, modulo: string) {
    const formularios = getCatalogoModulo(modulo);
    const primerFormulario = Object.keys(formularios)[0] ?? "";
    const overrides = await this.getOverrides(tenantId, modulo, primerFormulario);

    const vistos = new Map<string, CampoCatalogo>();
    for (const def of Object.values(formularios)) {
      for (const c of def.campos) {
        if (!vistos.has(c.campo)) vistos.set(c.campo, c);
      }
    }

    return [...vistos.values()].map((c) => ({
      campo: c.campo,
      label: c.label,
      obligatorioSistema: c.obligatorioSistema,
      visible: overrides[c.campo]?.visible ?? c.defaultVisible ?? true,
    }));
  }

  /** Punto de entrada del panel superadmin: unificado si el módulo comparte campos, per-formulario si no (ej. stock). */
  async getConfigEfectivaParaSuperadmin(
    tenantId: string,
    modulo: string,
    formulario: string,
  ) {
    if (this.esCampoCompartido(modulo)) {
      return this.getConfigEfectivaModuloUnificado(tenantId, modulo);
    }
    return this.getConfigEfectiva(tenantId, modulo, formulario);
  }

  /**
   * Visibilidad efectiva de UN campo puntual para el tenant, usada por servicios que
   * necesitan decidir si un campo opt-in (ej. `precioTransportistaIvaIncluidoPct`,
   * default oculto) debe tenerse en cuenta en un cálculo de negocio, no solo en el
   * formulario. `formulario` es la señal canónica elegida para ese campo (no
   * necesariamente todos los formularios del módulo deben coincidir).
   */
  async isCampoVisible(
    tenantId: string,
    modulo: string,
    formulario: string,
    campo: string,
  ): Promise<boolean> {
    const campos = await this.getConfigEfectiva(tenantId, modulo, formulario);
        return campos.find((c) => c.campo === campo)?.visible ?? true;
  }

  /** Obtiene la configuración de visibilidad de todos los formularios de un módulo para el tenant. */
  async getConfigEfectivaModulo(tenantId: string, modulo: string) {
    const formularios = getCatalogoModulo(modulo);
    const rows = await this.prisma.tenantFieldConfig.findMany({
      where: { tenantId, modulo },
    });
    const overridesPorFormulario = new Map(
      rows.map((r) => [r.formulario, r.campos as CamposJson]),
    );
    const overridesCompartidos =
      overridesPorFormulario.get(VIAJES_CONFIG_COMPARTIDA) ?? {};

    const resultado: Record<string, Record<string, boolean>> = {};
    for (const [formulario, def] of Object.entries(formularios)) {
      const overrides = overridesPorFormulario.get(formulario) ?? {};
      resultado[formulario] = Object.fromEntries(
        def.campos.map((c) => [
          c.campo,
          this.esCampoCompartido(modulo)
            ? overridesCompartidos[c.campo]?.visible ??
              this.getLegacySharedVisible(rows, modulo, c.campo) ??
              c.defaultVisible ??
              true
            : overrides[c.campo]?.visible ?? c.defaultVisible ?? true,
        ]),
      );
    }
    return resultado;
  }

  async toggleCampo(
    tenantId: string,
    dto: ToggleFieldConfigDto,
    changedBy: string,
  ) {
    const formularioPersistencia = this.esCampoCompartido(dto.modulo)
      ? VIAJES_CONFIG_COMPARTIDA
      : dto.formulario;

    if (formularioPersistencia === VIAJES_CONFIG_COMPARTIDA) {
      // Busca el campo en cualquier formulario del módulo — como la visibilidad
      // es compartida entre alta/edición/detalle, un campo puede existir solo en
      // uno de ellos (ej. "activo" no está en alta_vehiculo) y el frontend ya no
      // manda necesariamente el formulario exacto que lo declara.
      let campoDef: CampoCatalogo | undefined;
      for (const formulario of Object.keys(getCatalogoModulo(dto.modulo))) {
        campoDef = getCatalogoFormulario(dto.modulo, formulario).find(
          (c) => c.campo === dto.campo,
        );
        if (campoDef) break;
      }
      if (campoDef?.obligatorioSistema && !dto.visible) {
        throw new BadRequestException(
          `El campo "${dto.campo}" es obligatorio a nivel sistema y no puede ocultarse.`,
        );
      }
      await this.upsertCampo(
        tenantId,
        dto.modulo,
        formularioPersistencia,
        dto.campo,
        dto.visible,
        changedBy,
        dto.formulario,
      );
      return;
    }

    const formulariosAActualizar = dto.aplicarATodosLosFormularios
      ? Object.keys(getCatalogoModulo(dto.modulo))
      : [dto.formulario];

    for (const formulario of formulariosAActualizar) {
      const catalogo = getCatalogoFormulario(dto.modulo, formulario);
      const campoDef = catalogo.find((c) => c.campo === dto.campo);

      // Si el campo no existe en el catálogo de este formulario puntual (al aplicar a todos), lo salteamos.
      if (!campoDef) continue;

      if (campoDef.obligatorioSistema && !dto.visible) {
        throw new BadRequestException(
          `El campo "${dto.campo}" es obligatorio a nivel sistema y no puede ocultarse.`,
        );
      }

      await this.upsertCampo(
        tenantId,
        dto.modulo,
        formulario,
        dto.campo,
        dto.visible,
        changedBy,
      );
    }
  }

  private async upsertCampo(
    tenantId: string,
    modulo: string,
    formulario: string,
    campo: string,
    visible: boolean,
    changedBy: string,
    formularioAuditoria = formulario,
  ) {
    const row = await this.prisma.tenantFieldConfig.findUnique({
      where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
    });
    const camposActuales = (row?.campos as CamposJson) ?? {};
    const configAnterior = camposActuales[campo] ?? null;
    const configNuevo: FieldConfigValue = { visible };
    const camposNuevos: CamposJson = {
      ...camposActuales,
      [campo]: configNuevo,
    };

    await this.prisma.$transaction([
      this.prisma.tenantFieldConfig.upsert({
        where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
        update: {
          campos: camposNuevos,
          updatedBy: changedBy,
          updatedAt: new Date(),
        },
        create: {
          tenantId,
          modulo,
          formulario,
          campos: camposNuevos,
          updatedBy: changedBy,
          updatedAt: new Date(),
        },
      }),
      this.prisma.tenantFieldConfigAuditLog.create({
        data: {
          tenantId,
          modulo,
          formulario: formularioAuditoria,
          campo,
          configAnterior: configAnterior ?? undefined,
          configNuevo,
          changedBy,
        },
      }),
    ]);
  }

  private esCampoCompartido(modulo: string) {
    return MODULOS_CAMPOS_COMPARTIDOS.has(modulo);
  }

  private async getOverrides(
    tenantId: string,
    modulo: string,
    formulario: string,
  ): Promise<CamposJson> {
    if (!this.esCampoCompartido(modulo)) {
      const row = await this.prisma.tenantFieldConfig.findUnique({
        where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
      });
      return (row?.campos as CamposJson) ?? {};
    }

    const rows = await this.prisma.tenantFieldConfig.findMany({
      where: { tenantId, modulo },
    });
    const shared = rows.find((row) => row.formulario === VIAJES_CONFIG_COMPARTIDA);
    const sharedOverrides = (shared?.campos as CamposJson) ?? {};
    const localOverrides =
      (rows.find((row) => row.formulario === formulario)?.campos as CamposJson) ?? {};

    const catalogFields = Object.values(getCatalogoModulo(modulo)).flatMap(
      (definition) => definition.campos,
    )
      .map((definition) => definition.campo);
    return Object.fromEntries(
      [...new Set([...Object.keys(sharedOverrides), ...Object.keys(localOverrides), ...catalogFields])].map(
        (campo) => [
          campo,
          {
            visible:
              this.esCampoCompartido(modulo)
                ? sharedOverrides[campo]?.visible ??
                  this.getLegacySharedVisible(rows, modulo, campo)
                : localOverrides[campo]?.visible,
          },
        ],
      ),
    );
  }

  private getLegacySharedVisible(
    rows: Array<{ formulario: string; campos: unknown }>,
    modulo: string,
    campo: string,
  ): boolean | undefined {
    if (!this.esCampoCompartido(modulo)) return undefined;
    for (const formulario of Object.keys(getCatalogoModulo(modulo))) {
      const campos = rows.find((row) => row.formulario === formulario)
        ?.campos as CamposJson | undefined;
      if (campos?.[campo]?.visible !== undefined) return campos[campo].visible;
    }
    return undefined;
  }

  getCatalogoCompleto() {
    return FIELD_CATALOG;
  }

  /** Obtiene el historial de auditoría de los campos modificados en una empresa */
  async getAuditLogs(clerkOrgId: string, modulo?: string, formulario?: string) {
    // Nota: Según tu schema, el tenantId en esta tabla apunta a clerkOrgId directamente.
    // Confirmemos buscando el tenant.
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId },
      select: { clerkOrgId: true }, // Usamos clerkOrgId porque tu relation reference apunta ahí
    });

    if (!tenant) throw new NotFoundException("Tenant no encontrado");

    const logs = await this.prisma.tenantFieldConfigAuditLog.findMany({
      where: {
        tenantId: tenant.clerkOrgId,
        ...(modulo ? { modulo } : {}),
        ...(formulario ? { formulario } : {}),
      },
      orderBy: { changedAt: "desc" }, // <-- CORREGIDO: Usamos changedAt
    });

    return logs.map((log) => {
      const ant = log.configAnterior as FieldConfigValue | null;
      const nue = log.configNuevo as FieldConfigValue | null;
      // Si no hay estado anterior (es el primer cambio), el default no siempre es
      // "visible" — depende de `defaultVisible` del campo en el catálogo (ver
      // field-catalog.ts; false para features opt-in como precioTransportistaIvaIncluidoPct).
      const campoDef = getCatalogoFormulario(log.modulo, log.formulario).find(
        (c) => c.campo === log.campo,
      );
      const defaultVisible = campoDef?.defaultVisible ?? true;

      return {
        id: log.id,
        modulo: log.modulo,
        formulario: log.formulario,
        campo: log.campo,
        estadoAnterior: ant ? ant.visible : defaultVisible,
        estadoNuevo: nue ? nue.visible : defaultVisible,
        userId: log.changedBy,
        createdAt: log.changedAt, // <-- CORREGIDO: Mapeamos changedAt para el frontend
      };
    });
  }
}
