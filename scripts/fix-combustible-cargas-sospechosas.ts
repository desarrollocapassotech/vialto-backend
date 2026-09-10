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
import { evaluarLitrosImporteFase1 } from '../src/shared/util/combustible-fase1.util';
import { corregirKmYCostoPorKm } from '../src/shared/util/combustible-fase2-km.util';

const prisma = new PrismaClient();

type Motivo =
  | 'litros_extremo'
  | 'importe_invalido'
  | 'precio_litro_fuera_de_rango';

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantIdArg };
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
  };
  // IDs marcados sospechosos en esta misma corrida — en --dry-run nada se persiste,
  // así que la fase 2 no podría verlos si solo mirara la BD real.
  const flaggedFase1 = new Set<string>();

  for (const carga of cargas) {
    const fechaStr = carga.fecha.toISOString().slice(0, 10);
    const fase1 = evaluarLitrosImporteFase1(carga.litros, carga.importe);

    if (fase1.litrosOriginal !== null) {
      console.log(
        `✅ ${fechaStr} | CORRIGE litros ${fase1.litrosOriginal} → ${fase1.litros} (÷1000) | ${carga.id}`,
      );
      corregidas++;
      if (!isDryRun) {
        await prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { litrosOriginal: fase1.litrosOriginal, litros: fase1.litros },
        });
      }
      continue;
    }

    if (fase1.sospechoso) {
      const detalle =
        fase1.motivoSospecha === 'litros_extremo'
          ? `sin factor limpio: ${carga.litros}L`
          : fase1.motivoSospecha === 'importe_invalido'
            ? `$${carga.importe}`
            : `$${(carga.importe / carga.litros).toFixed(2)}/L`;
      console.log(`⚠️  ${fechaStr} | SOSPECHOSA (${fase1.motivoSospecha}: ${detalle}) | ${carga.id}`);
      sospechosas++;
      porMotivo[fase1.motivoSospecha as Motivo]++;
      flaggedFase1.add(carga.id);
      if (!isDryRun) {
        await prisma.cargaCombustible.update({
          where: { id: carga.id },
          data: { sospechoso: true, motivoSospecha: fase1.motivoSospecha },
        });
      }
      continue;
    }

    // ── sin problemas ─────────────────────────────────────────────────────
    sinCambios++;
  }

  console.log('\n─────────────────────────────────────────────────────────');
  console.log('Fase 2: km (por vehículo, en cadena cronológica)\n');

  const fase2 = await corregirKmYCostoPorKm(prisma, {
    tenantId: tenantIdArg,
    isDryRun,
    flaggedFase1,
    onEvento: (msg) => console.log(msg),
  });

  console.log(`\nCargas con vehículo evaluadas: ${fase2.cargasEvaluadas}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 Resultado:');
  console.log(`   Total procesadas (fase 1):     ${cargas.length}`);
  console.log(`   Corregidas (litros ÷1000):     ${corregidas}`);
  console.log(`   Corregidas (km ÷10/100/1000):  ${fase2.kmCorregidas}`);
  console.log(`   Marcadas sospechosas:          ${sospechosas + fase2.kmSospechosas + fase2.costoKmSospechosas}`);
  console.log(`     - litros_extremo:             ${porMotivo.litros_extremo}`);
  console.log(`     - importe_invalido:           ${porMotivo.importe_invalido}`);
  console.log(`     - precio_litro_fuera_de_rango: ${porMotivo.precio_litro_fuera_de_rango}`);
  console.log(`     - km_delta_invalido:           ${fase2.kmSospechosas}`);
  console.log(`     - costo_km_invalido:           ${fase2.costoKmSospechosas}`);
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
