import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { getCatalogoFormulario, getCatalogoModulo, FIELD_CATALOG } from './field-catalog';
import { ToggleFieldConfigDto } from './dto/toggle-field-config.dto';

type FieldConfigValue = { visible: boolean };
type CamposJson = Record<string, FieldConfigValue>;

@Injectable()
export class TenantFieldConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Obtiene la configuración de un formulario combinando el catálogo base con la configuración del tenant. */
  async getConfigEfectiva(tenantId: string, modulo: string, formulario: string) {
    const catalogo = getCatalogoFormulario(modulo, formulario);
    const row = await this.prisma.tenantFieldConfig.findUnique({
      where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
    });
    const overrides = (row?.campos as CamposJson) ?? {};

    return catalogo.map((c) => ({
      campo: c.campo,
      label: c.label,
      obligatorioSistema: c.obligatorioSistema,
      visible: overrides[c.campo]?.visible ?? true,
    }));
  }

  /** Obtiene la configuración de visibilidad de todos los formularios de un módulo para el tenant. */
  async getConfigEfectivaModulo(tenantId: string, modulo: string) {
    const formularios = getCatalogoModulo(modulo);
    const rows = await this.prisma.tenantFieldConfig.findMany({
      where: { tenantId, modulo },
    });
    const overridesPorFormulario = new Map(rows.map((r) => [r.formulario, r.campos as CamposJson]));

    const resultado: Record<string, Record<string, boolean>> = {};
    for (const [formulario, def] of Object.entries(formularios)) {
      const overrides = overridesPorFormulario.get(formulario) ?? {};
      resultado[formulario] = Object.fromEntries(
        def.campos.map((c) => [c.campo, overrides[c.campo]?.visible ?? true]),
      );
    }
    return resultado;
  }

  async toggleCampo(tenantId: string, dto: ToggleFieldConfigDto, changedBy: string) {
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

      await this.upsertCampo(tenantId, dto.modulo, formulario, dto.campo, dto.visible, changedBy);
    }
  }

  private async upsertCampo(
    tenantId: string,
    modulo: string,
    formulario: string,
    campo: string,
    visible: boolean,
    changedBy: string,
  ) {
    const row = await this.prisma.tenantFieldConfig.findUnique({
      where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
    });
    const camposActuales = (row?.campos as CamposJson) ?? {};
    const configAnterior = camposActuales[campo] ?? null;
    const configNuevo: FieldConfigValue = { visible };
    const camposNuevos: CamposJson = { ...camposActuales, [campo]: configNuevo };

    await this.prisma.$transaction([
      this.prisma.tenantFieldConfig.upsert({
        where: { tenantId_modulo_formulario: { tenantId, modulo, formulario } },
        update: { campos: camposNuevos, updatedBy: changedBy },
        create: {
          tenantId,
          modulo,
          formulario,
          campos: camposNuevos,
          updatedBy: changedBy,
        },
      }),
      this.prisma.tenantFieldConfigAuditLog.create({
        data: {
          tenantId,
          modulo,
          formulario,
          campo,
          configAnterior: configAnterior ?? undefined,
          configNuevo,
          changedBy,
        },
      }),
    ]);
  }

  getCatalogoCompleto() {
    return FIELD_CATALOG;
  }
}