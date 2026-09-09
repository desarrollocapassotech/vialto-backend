import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { evaluarLitrosImporteFase1 } from "../../shared/util/combustible-fase1.util";
import { corregirKmYCostoPorKm } from "../../shared/util/combustible-fase2-km.util";

/**
 * Corrida diaria de detección/corrección de cargas de combustible sospechosas — ver
 * docs/combustible-correccion-cargas-historicas.md.
 *
 * Fase 1 (litros/importe) ya corre en vivo al crear una carga
 * (`CombustibleService.create`/`createByChofer`, vía `evaluarLitrosImporteFase1`) —
 * acá es una red de seguridad para lo que se cuele por otra vía (futuro import
 * masivo, escritura directa, backlog previo a este cambio).
 *
 * Fase 2/3 (km y costo/km) SÍ dependen de este cron: comparan cada carga contra la
 * FÍSICAMENTE anterior y siguiente del mismo vehículo, y la "siguiente" no existe
 * todavía en el momento de crear una carga nueva — no se pueden evaluar en vivo.
 *
 * Reemplaza la necesidad de correr `scripts/fix-combustible-cargas-sospechosas.ts`
 * a mano periódicamente (ver "Pendiente" del doc — quedó 5 semanas sin correrse en
 * producción por depender de que alguien se acuerde). El script sigue existiendo
 * para pases puntuales (ej. `--tenant-id` acotado, verificación manual con
 * `--dry-run`), ambos apuntan a las mismas funciones compartidas.
 */
@Injectable()
export class CombustibleCorreccionCronService {
  private readonly logger = new Logger(CombustibleCorreccionCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Domingo 4:00 AM hora Argentina — fuera del horario de uso de la app del chofer.
   * Semanal en vez de diario: fase 1 corre en vivo en cada alta (este cron es solo
   * una red de seguridad para lo que se cuele por otra vía) y fase 2/3 no necesita
   * granularidad diaria — una demora de hasta una semana en detectar un km_delta
   * inválido no afecta ninguna operación en tiempo real, y evita correr el barrido
   * completo de cargas todos los días.
   */
  @Cron("0 4 * * 0", {
    timeZone: "America/Argentina/Buenos_Aires",
  })
  async cronSemanal(): Promise<void> {
    this.logger.log("Ejecutando corrección semanal de cargas de combustible...");
    try {
      const resultado = await this.correr();
      this.logger.log(
        `Fase 1: ${resultado.fase1Corregidas} corregidas, ${resultado.fase1Sospechosas} sospechosas. ` +
          `Fase 2/3: ${resultado.fase2.kmCorregidas} km corregidos, ` +
          `${resultado.fase2.kmSospechosas} km sospechosas, ${resultado.fase2.costoKmSospechosas} costo/km sospechosas ` +
          `(${resultado.fase2.cargasEvaluadas} cargas con vehículo evaluadas).`,
      );
    } catch (error) {
      this.logger.error(
        "Error en la corrección semanal de cargas de combustible",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Extraído del cron para poder invocarlo también manualmente (ej. trigger de superadmin) sin esperar al horario. */
  async correr(tenantId?: string) {
    const cargas = await this.prisma.cargaCombustible.findMany({
      where: {
        sospechoso: false,
        litrosOriginal: null,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true, litros: true, importe: true },
    });

    let fase1Corregidas = 0;
    let fase1Sospechosas = 0;
    const flaggedFase1 = new Set<string>();

    for (const carga of cargas) {
      const evaluacion = evaluarLitrosImporteFase1(carga.litros, carga.importe);
      if (evaluacion.litrosOriginal !== null) {
        fase1Corregidas++;
        await this.prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: {
            litrosOriginal: evaluacion.litrosOriginal,
            litros: evaluacion.litros,
          },
        });
      } else if (evaluacion.sospechoso) {
        fase1Sospechosas++;
        flaggedFase1.add(carga.id);
        await this.prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { sospechoso: true, motivoSospecha: evaluacion.motivoSospecha },
        });
      }
    }

    const fase2 = await corregirKmYCostoPorKm(this.prisma, {
      tenantId,
      flaggedFase1,
    });

    return { fase1Corregidas, fase1Sospechosas, fase2 };
  }
}
