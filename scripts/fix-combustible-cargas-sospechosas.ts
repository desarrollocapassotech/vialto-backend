/**
 * Detecta y corrige inconsistencias en cargas de combustible históricas
 * (litros / importe / precio por litro incoherentes, producto de errores
 * de carga manual — ver docs/combustible-correccion-cargas-historicas.md).
 *
 * No requiere Firestore: solo lee y escribe en PostgreSQL.
 *
 * Reglas (idénticas en QA y producción — el mismo script corre en ambos entornos,
 * cambia solo el DATABASE_URL activo):
 *
 *   1. litros >= 100.000 → se prueba litros / 1000. Si el resultado cae en un rango
 *      físico plausible (5–1000 litros) y el precio/litro resultante en $900–3500,
 *      se corrige automáticamente (litrosOriginal guarda el valor previo).
 *      Si no, se marca sospechosa (motivo: litros_extremo).
 *   2. importe <= 0 → sospechosa (motivo: importe_invalido). No hay corrección posible.
 *   3. precio/litro (importe / litros) fuera de $900–3500, sin haber caído en (1) ni (2)
 *      → sospechosa (motivo: precio_litro_fuera_de_rango). No hay corrección posible
 *      (no existe un factor único que explique este grupo — ver doc).
 *
 * Idempotente: solo procesa cargas nunca antes tocadas por este script
 * (sospechoso = false AND litrosOriginal IS NULL). Correr de nuevo no repite trabajo,
 * así que sirve tanto para el pase histórico como para pasadas periódicas mientras
 * la causa de origen (carga manual) no esté resuelta.
 *
 * Uso:
 *   npm run fix:combustible:dry                  ← preview sin tocar la BD
 *   npm run fix:combustible                      ← aplica los cambios
 *   npm run fix:combustible -- --tenant-id org_xxx   ← limita a un tenant
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LITROS_EXTREMO_UMBRAL = 100_000;
const FACTOR_CORRECCION = 1000;
const LITROS_PLAUSIBLE_MIN = 5;
const LITROS_PLAUSIBLE_MAX = 1000;
const PRECIO_LITRO_MIN = 900;
const PRECIO_LITRO_MAX = 3500;

type Motivo = 'litros_extremo' | 'importe_invalido' | 'precio_litro_fuera_de_rango';

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

  console.log(`Cargas sin procesar encontradas: ${cargas.length}`);
  if (cargas.length === 0) {
    console.log('Nada que hacer.');
    return;
  }
  console.log('─────────────────────────────────────────────────────────\n');

  let corregidas = 0;
  let sospechosas = 0;
  let sinCambios = 0;
  const porMotivo: Record<Motivo, number> = {
    litros_extremo: 0,
    importe_invalido: 0,
    precio_litro_fuera_de_rango: 0,
  };

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

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 Resultado:');
  console.log(`   Total procesadas:              ${cargas.length}`);
  console.log(`   Corregidas (litros ÷1000):     ${corregidas}`);
  console.log(`   Marcadas sospechosas:          ${sospechosas}`);
  console.log(`     - litros_extremo:             ${porMotivo.litros_extremo}`);
  console.log(`     - importe_invalido:           ${porMotivo.importe_invalido}`);
  console.log(`     - precio_litro_fuera_de_rango: ${porMotivo.precio_litro_fuera_de_rango}`);
  console.log(`   Sin cambios (ya coherentes):    ${sinCambios}`);

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
