/**
 * Detección/corrección de km y costo/km incoherentes en cargas de combustible
 * (fases 2 y 3 — por vehículo, en cadena cronológica; ver
 * docs/combustible-correccion-cargas-historicas.md). A diferencia de fase 1
 * (`combustible-fase1.util.ts`), estas fases necesitan la carga FÍSICAMENTE
 * anterior y siguiente del mismo vehículo, así que no pueden evaluarse en el
 * momento de crear una carga nueva (la "siguiente" todavía no existe) — corren
 * como pasada periódica (cron diario, `CombustibleCorreccionCronService`) y
 * como parte del script histórico (`scripts/fix-combustible-cargas-sospechosas.ts`),
 * ambos apuntando a esta misma función para no duplicar la regla de negocio.
 */

import { KM_DELTA_PLAUSIBLE_MAX } from "./combustible-km.constants";

const KM_FACTORES = [10, 100, 1000];
const COSTO_KM_PLAUSIBLE_MAX = 3000;

export interface Fase2Resultado {
  cargasEvaluadas: number;
  kmCorregidas: number;
  kmSospechosas: number;
  costoKmSospechosas: number;
}

interface CargaKmRow {
  id: string;
  vehiculoId: string | null;
  km: number;
  importe: number;
  fecha: Date;
  sospechoso: boolean;
  kmOriginal: number | null;
}

/** Subconjunto de PrismaClient/PrismaService que esta función necesita — permite pasar cualquiera de los dos. */
export interface CargaCombustibleFase2Client {
  cargaCombustible: {
    findMany: (args: unknown) => Promise<CargaKmRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
}

/**
 * Prueba ×10/×100/×1000 (para km demasiado bajo) y ÷10/÷100/÷1000 (para km demasiado
 * alto) sobre `actual`, y devuelve el primer resultado cuyo delta contra `anterior`
 * (y contra `siguiente`, si existe) caiga en [0, KM_DELTA_PLAUSIBLE_MAX] en ambos
 * lados. null si ningún factor da una cadena consistente con los vecinos.
 */
function probarCorreccionKm(
  actual: number,
  anterior: number,
  siguiente: number | null,
): number | null {
  const candidatos = KM_FACTORES.flatMap((f) => [
    Math.round(actual / f),
    Math.round(actual * f),
  ]);
  for (const corregido of candidatos) {
    const deltaIn = corregido - anterior;
    if (deltaIn < 0 || deltaIn > KM_DELTA_PLAUSIBLE_MAX) continue;
    if (siguiente !== null) {
      const deltaOut = siguiente - corregido;
      if (deltaOut < 0 || deltaOut > KM_DELTA_PLAUSIBLE_MAX) continue;
    }
    return corregido;
  }
  return null;
}

/**
 * Evalúa y corrige/marca km y costo/km de todas las cargas con vehículo (o de un
 * tenant puntual). Idempotente: solo evalúa cargas con `kmOriginal = null` que no
 * estén ya `sospechoso` (por esta pasada o por fase 1 — `flaggedFase1` cubre los IDs
 * marcados en la misma corrida cuando `isDryRun` no persiste nada todavía).
 */
export async function corregirKmYCostoPorKm(
  prisma: CargaCombustibleFase2Client,
  options: {
    tenantId?: string;
    isDryRun?: boolean;
    flaggedFase1?: Set<string>;
    onEvento?: (mensaje: string) => void;
  } = {},
): Promise<Fase2Resultado> {
  const { tenantId, isDryRun = false, flaggedFase1 = new Set(), onEvento } = options;
  const log = onEvento ?? (() => {});

  // Sin filtrar por sospechoso acá: el km de una carga litros/importe-sospechosa
  // sigue siendo un dato real del odómetro y sirve como vecino físico confiable.
  // Filtrar por sospechoso generaría un efecto cascada — ver doc.
  const cargasConVehiculo = await prisma.cargaCombustible.findMany({
    where: {
      vehiculoId: { not: null },
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      vehiculoId: true,
      km: true,
      importe: true,
      fecha: true,
      sospechoso: true,
      kmOriginal: true,
    },
    orderBy: [{ vehiculoId: "asc" }, { fecha: "asc" }],
  });

  const porVehiculo = new Map<string, CargaKmRow[]>();
  for (const c of cargasConVehiculo) {
    const arr = porVehiculo.get(c.vehiculoId!) ?? [];
    arr.push(c);
    porVehiculo.set(c.vehiculoId!, arr);
  }

  let kmCorregidas = 0;
  let kmSospechosas = 0;
  let costoKmSospechosas = 0;

  for (const [, lista] of porVehiculo) {
    for (let i = 1; i < lista.length; i++) {
      const actual = lista[i];
      const anterior = lista[i - 1];
      const siguiente = lista[i + 1] ?? null;

      if (actual.sospechoso || flaggedFase1.has(actual.id) || actual.kmOriginal !== null) {
        continue;
      }

      const fechaStr = actual.fecha.toISOString().slice(0, 10);
      let delta = actual.km - anterior.km;

      if (Math.abs(delta) > KM_DELTA_PLAUSIBLE_MAX) {
        const corregido = probarCorreccionKm(actual.km, anterior.km, siguiente?.km ?? null);

        if (corregido !== null) {
          log(`✅ ${fechaStr} | CORRIGE km ${actual.km} → ${corregido} | ${actual.id}`);
          kmCorregidas++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { kmOriginal: actual.km, km: corregido },
            });
          }
          actual.km = corregido;
          delta = corregido - anterior.km;
        } else {
          log(
            `⚠️  ${fechaStr} | SOSPECHOSA (km_delta_invalido: ${delta > 0 ? "+" : ""}${delta}km respecto a la carga físicamente anterior) | ${actual.id}`,
          );
          kmSospechosas++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { sospechoso: true, motivoSospecha: "km_delta_invalido" },
            });
          }
          continue;
        }
      }

      if (delta > 0) {
        const costoKm = actual.importe / delta;
        if (costoKm > COSTO_KM_PLAUSIBLE_MAX) {
          log(
            `⚠️  ${fechaStr} | SOSPECHOSA (costo_km_invalido: $${Math.round(costoKm).toLocaleString("es-AR")}/km) | ${actual.id}`,
          );
          costoKmSospechosas++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { sospechoso: true, motivoSospecha: "costo_km_invalido" },
            });
          }
        }
      }
    }
  }

  return {
    cargasEvaluadas: cargasConVehiculo.length,
    kmCorregidas,
    kmSospechosas,
    costoKmSospechosas,
  };
}
