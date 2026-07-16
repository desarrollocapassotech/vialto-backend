/**
 * Detecta y corrige inconsistencias en cargas de combustible históricas
 * (litros / importe / precio por litro / km incoherentes, producto de errores
 * de carga manual — ver docs/combustible-correccion-cargas-historicas.md).
 *
 * No requiere Firestore: solo lee y escribe en PostgreSQL.
 *
 * Reglas (idénticas en QA y producción — el mismo script corre en ambos entornos,
 * cambia solo el DATABASE_URL activo):
 *
 * Fase 1 — litros / importe (por fila, sin contexto de otras cargas):
 *   1. litros >= 100.000 → se prueba litros / 1000. Si el resultado cae en un rango
 *      físico plausible (5–1000 litros) y el precio/litro resultante en $900–3500,
 *      se corrige automáticamente (litrosOriginal guarda el valor previo).
 *      Si no, se marca sospechosa (motivo: litros_extremo).
 *   2. importe <= 0 → sospechosa (motivo: importe_invalido). No hay corrección posible.
 *   3. precio/litro (importe / litros) fuera de $900–3500, sin haber caído en (1) ni (2)
 *      → sospechosa (motivo: precio_litro_fuera_de_rango). No hay corrección posible
 *      (no existe un factor único que explique este grupo — ver doc).
 *
 * Fase 2 — km (por vehículo, en cadena cronológica):
 *   El km es una secuencia por vehículo (odómetro), así que a diferencia de litros
 *   no alcanza con mirar la fila sola — se compara cada carga contra la carga
 *   FÍSICAMENTE anterior y la siguiente del mismo vehículo (por fecha), sin importar
 *   si esas vecinas están marcadas sospechosas por litros/importe: su km sigue siendo
 *   un dato real del odómetro. (Ojo: filtrar por sospechoso acá, como hace la query
 *   "historicas" del dashboard, genera cascada — cada carga excluida corre el ancla
 *   más atrás, y el delta termina midiendo kilometraje real acumulado de varias
 *   cargas seguidas en vez de una sola, disparando falsos positivos.)
 *   |delta| > 5.000 km entre cargas consecutivas (para arriba o para abajo — un
 *   retroceso brusco es tan inválido como un salto) se considera imposible. Se prueba
 *   corregir con ×10/×100/×1000 (km demasiado bajo) o ÷10/÷100/÷1000 (demasiado alto);
 *   se acepta la corrección solo si el km resultante da un delta razonable (0–5.000 km)
 *   contra AMBOS vecinos físicos — a diferencia de litros, acá no hay un factor único
 *   dominante (ver doc), así que la validación contra los dos vecinos es lo que evita
 *   "inventar" un valor por fila. Si no hay corrección válida → sospechosa (motivo:
 *   km_delta_invalido). Las cargas ya sospechosas de la fase 1 no se reevalúan, pero
 *   su km sigue sirviendo de vecino físico para las demás filas del vehículo.
 *
 * Fase 3 — costo por km de una sola carga (misma cadena de la fase 2):
 *   Litros/importe pueden verse individualmente plausibles (fase 1 no los marca) y el
 *   delta de km contra la carga anterior también (fase 2 no lo marca), pero la
 *   COMBINACIÓN de ambos puede seguir sin tener sentido — ej. un vehículo con el km
 *   roto durante meses (secuencia chica y autoconsistente, tipo 272, 273, 274…, en vez
 *   del odómetro real) más una carga con importe alto: cada pieza pasa sus propios
 *   filtros, pero importe / delta_km da un costo por km absurdo. Se probó contra las
 *   cargas ya limpias: mediana real $508/km, percentil 95 $856/km, y de ahí un salto
 *   directo a cientos de miles — no hay zona gris, así que $3.000/km (dato del negocio)
 *   separa limpio lo real de lo roto sin riesgo de falsos positivos. No hay corrección
 *   posible (es ambiguo si el problema es el importe o el km) → sospechosa (motivo:
 *   costo_km_invalido).
 *
 * Idempotente: solo procesa cargas nunca antes tocadas por este script
 * (sospechoso = false AND litrosOriginal IS NULL, y para km, kmOriginal IS NULL).
 * Correr de nuevo no repite trabajo, así que sirve tanto para el pase histórico como
 * para pasadas periódicas mientras la causa de origen (carga manual) no esté resuelta.
 *
 * Uso:
 *   npm run fix:combustible:dry                  ← preview sin tocar la BD
 *   npm run fix:combustible                      ← aplica los cambios
 *   npm run fix:combustible -- --tenant-id org_xxx   ← limita a un tenant
 */

import { PrismaClient } from '@prisma/client';
import { KM_DELTA_PLAUSIBLE_MAX } from '../src/shared/util/combustible-km.constants';

const prisma = new PrismaClient();

const LITROS_EXTREMO_UMBRAL = 100_000;
const FACTOR_CORRECCION = 1000;
const LITROS_PLAUSIBLE_MIN = 5;
const LITROS_PLAUSIBLE_MAX = 1000;
const PRECIO_LITRO_MIN = 900;
const PRECIO_LITRO_MAX = 3500;

const KM_DELTA_UMBRAL = KM_DELTA_PLAUSIBLE_MAX;
const KM_FACTORES = [10, 100, 1000];
const COSTO_KM_PLAUSIBLE_MAX = 3000;

type Motivo =
  | 'litros_extremo'
  | 'importe_invalido'
  | 'precio_litro_fuera_de_rango'
  | 'km_delta_invalido'
  | 'costo_km_invalido';

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantIdArg };
}

function enRango(valor: number, min: number, max: number): boolean {
  return valor >= min && valor <= max;
}

/**
 * Prueba ×10/×100/×1000 (para km demasiado bajo) y ÷10/÷100/÷1000 (para km demasiado
 * alto) sobre `actual`, y devuelve el primer resultado cuyo delta contra `anterior`
 * (y contra `siguiente`, si existe) caiga en [0, KM_DELTA_UMBRAL] en ambos lados.
 * null si ningún factor da una cadena consistente con los vecinos.
 */
function probarCorreccionKm(actual: number, anterior: number, siguiente: number | null): number | null {
  const candidatos = KM_FACTORES.flatMap((f) => [Math.round(actual / f), Math.round(actual * f)]);
  for (const corregido of candidatos) {
    const deltaIn = corregido - anterior;
    if (deltaIn < 0 || deltaIn > KM_DELTA_UMBRAL) continue;
    if (siguiente !== null) {
      const deltaOut = siguiente - corregido;
      if (deltaOut < 0 || deltaOut > KM_DELTA_UMBRAL) continue;
    }
    return corregido;
  }
  return null;
}

async function main() {
  const { isDryRun, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Corrección de cargas de combustible sospechosas');
  console.log(`  Modo: ${isDryRun ? '🔍 DRY RUN (sin cambios en BD)' : '✍️  APLICANDO CAMBIOS'}`);
  if (tenantIdArg) console.log(`  Tenant: ${tenantIdArg}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const cargas = await prisma.cargaCombustible.findMany({
    where: {
      sospechoso: false,
      litrosOriginal: null,
      ...(tenantIdArg ? { tenantId: tenantIdArg } : {}),
    },
    select: { id: true, tenantId: true, litros: true, importe: true, fecha: true },
    orderBy: { fecha: 'asc' },
  });

  console.log(`Cargas sin procesar encontradas (fase 1): ${cargas.length}`);
  console.log('─────────────────────────────────────────────────────────\n');

  let corregidas = 0;
  let sospechosas = 0;
  let sinCambios = 0;
  const porMotivo: Record<Motivo, number> = {
    litros_extremo: 0,
    importe_invalido: 0,
    precio_litro_fuera_de_rango: 0,
    km_delta_invalido: 0,
    costo_km_invalido: 0,
  };
  // IDs marcados sospechosos en esta misma corrida — en --dry-run nada se persiste,
  // así que la fase 2 no podría verlos si solo mirara la BD real.
  const flaggedFase1 = new Set<string>();

  for (const carga of cargas) {
    const fechaStr = carga.fecha.toISOString().slice(0, 10);

    // ── 1. litros extremo → intentar corrección ÷1000 ──────────────────────
    if (carga.litros >= LITROS_EXTREMO_UMBRAL) {
      const litrosCorregidos = carga.litros / FACTOR_CORRECCION;
      const precioCorregido = carga.importe > 0 ? carga.importe / litrosCorregidos : 0;

      if (
        enRango(litrosCorregidos, LITROS_PLAUSIBLE_MIN, LITROS_PLAUSIBLE_MAX) &&
        enRango(precioCorregido, PRECIO_LITRO_MIN, PRECIO_LITRO_MAX)
      ) {
        console.log(
          `✅ ${fechaStr} | CORRIGE litros ${carga.litros} → ${litrosCorregidos} (÷1000) | ${carga.id}`,
        );
        corregidas++;
        if (!isDryRun) {
          await prisma.cargaCombustible.update({
            where: { id: carga.id },
            data: { litrosOriginal: carga.litros, litros: litrosCorregidos },
          });
        }
        continue;
      }

      console.log(`⚠️  ${fechaStr} | SOSPECHOSA (litros_extremo, sin factor limpio: ${carga.litros}L) | ${carga.id}`);
      sospechosas++;
      porMotivo.litros_extremo++;
      flaggedFase1.add(carga.id);
      if (!isDryRun) {
        await prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { sospechoso: true, motivoSospecha: 'litros_extremo' },
        });
      }
      continue;
    }

    // ── 2. importe inválido ─────────────────────────────────────────────────
    if (carga.importe <= 0) {
      console.log(`⚠️  ${fechaStr} | SOSPECHOSA (importe_invalido: $${carga.importe}) | ${carga.id}`);
      sospechosas++;
      porMotivo.importe_invalido++;
      flaggedFase1.add(carga.id);
      if (!isDryRun) {
        await prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { sospechoso: true, motivoSospecha: 'importe_invalido' },
        });
      }
      continue;
    }

    // ── 3. precio/litro fuera de rango ──────────────────────────────────────
    const precioLitro = carga.importe / carga.litros;
    if (!enRango(precioLitro, PRECIO_LITRO_MIN, PRECIO_LITRO_MAX)) {
      console.log(
        `⚠️  ${fechaStr} | SOSPECHOSA (precio_litro_fuera_de_rango: $${precioLitro.toFixed(2)}/L) | ${carga.id}`,
      );
      sospechosas++;
      porMotivo.precio_litro_fuera_de_rango++;
      flaggedFase1.add(carga.id);
      if (!isDryRun) {
        await prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { sospechoso: true, motivoSospecha: 'precio_litro_fuera_de_rango' },
        });
      }
      continue;
    }

    // ── 4. sin problemas ─────────────────────────────────────────────────────
    sinCambios++;
  }

  console.log('\n─────────────────────────────────────────────────────────');
  console.log('Fase 2: km (por vehículo, en cadena cronológica)\n');

  // Sin filtrar por sospechoso acá: el km de una carga litros/importe-sospechosa
  // sigue siendo un dato real del odómetro y sirve como vecino físico confiable
  // para juzgar si LA CARGA SIGUIENTE tiene un km plausible. Filtrar por sospechoso
  // (como hace el dashboard) generaría un efecto cascada: al saltear cada carga ya
  // excluida, el delta se mide contra un ancla cada vez más vieja y termina
  // "detectando" como anómalos huecos que en realidad son kilometraje real
  // acumulado durante varias cargas seguidas con importe/litros mal tipeados.
  const cargasConVehiculo = await prisma.cargaCombustible.findMany({
    where: {
      vehiculoId: { not: null },
      ...(tenantIdArg ? { tenantId: tenantIdArg } : {}),
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
    orderBy: [{ vehiculoId: 'asc' }, { fecha: 'asc' }],
  });

  const porVehiculo = new Map<string, typeof cargasConVehiculo>();
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

      // Ya resuelta antes (por esta fase o por la 1) — no se reevalúa, pero su km
      // (real u original) sigue sirviendo de vecino físico para las demás filas.
      if (actual.sospechoso || flaggedFase1.has(actual.id) || actual.kmOriginal !== null) continue;

      const fechaStr = actual.fecha.toISOString().slice(0, 10);
      let delta = actual.km - anterior.km;

      if (Math.abs(delta) > KM_DELTA_UMBRAL) {
        const corregido = probarCorreccionKm(actual.km, anterior.km, siguiente?.km ?? null);

        if (corregido !== null) {
          console.log(`✅ ${fechaStr} | CORRIGE km ${actual.km} → ${corregido} | ${actual.id}`);
          kmCorregidas++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { kmOriginal: actual.km, km: corregido },
            });
          }
          actual.km = corregido; // mantiene la cadena consistente para las próximas iteraciones
          delta = corregido - anterior.km;
        } else {
          console.log(
            `⚠️  ${fechaStr} | SOSPECHOSA (km_delta_invalido: ${delta > 0 ? '+' : ''}${delta}km respecto a la carga físicamente anterior) | ${actual.id}`,
          );
          kmSospechosas++;
          porMotivo.km_delta_invalido++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { sospechoso: true, motivoSospecha: 'km_delta_invalido' },
            });
          }
          continue; // km no confiable — no tiene sentido evaluar costo/km sobre este delta
        }
      }

      // ── Fase 3: costo por km de esta carga puntual (delta ya plausible o recién corregido) ──
      if (delta > 0) {
        const costoKm = actual.importe / delta;
        if (costoKm > COSTO_KM_PLAUSIBLE_MAX) {
          console.log(
            `⚠️  ${fechaStr} | SOSPECHOSA (costo_km_invalido: $${Math.round(costoKm).toLocaleString('es-AR')}/km) | ${actual.id}`,
          );
          costoKmSospechosas++;
          porMotivo.costo_km_invalido++;
          if (!isDryRun) {
            await prisma.cargaCombustible.update({
              where: { id: actual.id },
              data: { sospechoso: true, motivoSospecha: 'costo_km_invalido' },
            });
          }
        }
      }
    }
  }

  console.log(`\nCargas con vehículo evaluadas: ${cargasConVehiculo.length}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 Resultado:');
  console.log(`   Total procesadas (fase 1):     ${cargas.length}`);
  console.log(`   Corregidas (litros ÷1000):     ${corregidas}`);
  console.log(`   Corregidas (km ÷10/100/1000):  ${kmCorregidas}`);
  console.log(`   Marcadas sospechosas:          ${sospechosas + kmSospechosas + costoKmSospechosas}`);
  console.log(`     - litros_extremo:             ${porMotivo.litros_extremo}`);
  console.log(`     - importe_invalido:           ${porMotivo.importe_invalido}`);
  console.log(`     - precio_litro_fuera_de_rango: ${porMotivo.precio_litro_fuera_de_rango}`);
  console.log(`     - km_delta_invalido:           ${porMotivo.km_delta_invalido}`);
  console.log(`     - costo_km_invalido:           ${porMotivo.costo_km_invalido}`);
  console.log(`   Sin cambios (fase 1, ya coherentes): ${sinCambios}`);

  if (isDryRun) {
    console.log('\n💡 Ejecutar sin --dry-run para aplicar los cambios en la BD.');
  } else {
    console.log('\n✅ Corrección completada.');
  }
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
