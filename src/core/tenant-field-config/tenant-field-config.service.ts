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
} from "./field-catalog";
import { ToggleFieldConfigDto } from "./dto/toggle-field-config.dto";

type FieldConfigValue = { visible: boolean };
type CamposJson = Record<string, FieldConfigValue>;

const VIAJES_CONFIG_COMPARTIDA = "viajes_compartidos";

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
      const campoDef = getCatalogoFormulario(dto.modulo, dto.formulario).find(
        (c) => c.campo === dto.campo,
      );
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
    return modulo === "viajes";
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
