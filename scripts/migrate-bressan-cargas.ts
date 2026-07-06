/**
 * Migra las cargas históricas de Bressan desde Firestore a PostgreSQL de Vialto.
 *
 * FIRESTORE: solo lectura. No modifica nada en Firestore.
 *
 * Auto-crea choferes y vehículos faltantes en Vialto:
 *   - Vehículo nuevo: patente del doc Firestore, tipo="otro", resto null
 *   - Chofer nuevo:   nombre y dni del doc Firestore, resto null
 *
 * Prerequisitos:
 *   1. Descargar clave de servicio desde Firebase Console:
 *      bressan-registro-combustible → Configuración → Cuentas de servicio
 *      → Generar nueva clave privada → guardar en scripts/bressan-service-account.json
 *   2. DATABASE_URL configurado en el entorno
 *   3. Tenant "Grupo Bressan" creado en Vialto
 *
 * Uso:
 *   npm run migrate:bressan:dry          ← preview sin tocar la BD
 *   npm run migrate:bressan              ← inserción real
 *   npm run migrate:bressan -- --tenant-id org_xxx
 */

import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import { hashPin } from '../src/shared/util/pin-hash';

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'bressan-registro-combustible-firebase-adminsdk-fbsvc-3144f8b0b7.json');
const FIREBASE_PROJECT_ID = 'bressan-registro-combustible';

interface FirestoreCarga {
  id: string;
  empresaId: string;
  driverName: string;
  driverDni: number;
  licensePlate: string;
  serviceStation: string;
  totalAmount: number;
  liters: number;
  kilometers: number;
  date: Timestamp | Date | string;
  paymentMethod?: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const tidIdx = args.indexOf('--tenant-id');
  const tenantIdArg = tidIdx !== -1 ? args[tidIdx + 1] : undefined;
  return { isDryRun, tenantIdArg };
}

function resolveDate(d: Timestamp | Date | string): Date {
  if (d instanceof Date) return d;
  if (typeof d === 'string') return new Date(d);
  if (d && typeof (d as Timestamp).toDate === 'function') {
    return (d as Timestamp).toDate();
  }
  return new Date(d as never);
}

function normalizePatente(p: string): string {
  return (p ?? '').replace(/\s+/g, '').toUpperCase();
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { isDryRun, tenantIdArg } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Migración Bressan: Firestore → Vialto PostgreSQL');
  console.log(`  Modo: ${isDryRun ? '🔍 DRY RUN (sin cambios en BD)' : '✍️  INSERCIÓN REAL'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // 1. Verificar service account
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`❌ Archivo de service account no encontrado en:\n   ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
  }

  // 2. Inicializar Firebase Admin v14 (solo lectura)
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
  });
  const firestore = getFirestore(firebaseApp);

  // 3. Conectar Prisma
  const prisma = new PrismaClient();

  try {
    // 4. Encontrar el tenant Grupo Bressan en Vialto
    const tenant = tenantIdArg
      ? await prisma.tenant.findUnique({ where: { clerkOrgId: tenantIdArg } })
      : await prisma.tenant.findFirst({
          where: { name: { contains: 'Bressan', mode: 'insensitive' } },
        });

    if (!tenant) {
      console.error('❌ Tenant Bressan no encontrado en Vialto.');
      process.exit(1);
    }
    const tenantId = tenant.clerkOrgId;
    console.log(`✅ Tenant: "${tenant.name}" → ${tenantId}\n`);

    // 5. Cargar vehículos existentes → mapa patente : vehiculoId
    const vehiculos = await prisma.vehiculo.findMany({ where: { tenantId } });
    const vehiculoMap = new Map<string, string>(
      vehiculos.map((v) => [normalizePatente(v.patente), v.id]),
    );
    console.log(`🚗 Vehículos en Vialto (${vehiculos.length}):`);
    vehiculos.forEach((v) =>
      console.log(`   ${normalizePatente(v.patente).padEnd(10)} → ${v.id}`),
    );

    // 6. Cargar choferes existentes → mapa dni : { id, tienePin }
    const choferes = await prisma.chofer.findMany({ where: { tenantId } });
    const choferMap = new Map<string, string>();       // dni → choferId
    const choferSinPin = new Set<string>();            // choferId sin PIN seteado
    for (const ch of choferes) {
      if (ch.dni) {
        choferMap.set(ch.dni.trim(), ch.id);
        if (!ch.pin) choferSinPin.add(ch.id);
      }
    }
    console.log(`\n👤 Choferes en Vialto (${choferes.length}):`);
    choferes.forEach((ch) =>
      console.log(`   DNI ${(ch.dni ?? '-').padEnd(10)} → ${ch.id} (${ch.nombre}) PIN: ${ch.pin ? '✅' : '❌'}`),
    );

    // 7. Leer usuarios de Firestore → mapa dni : pass (para migrar PINs)
    console.log('\n🔑 Leyendo usuarios de Firestore para obtener PINs...');
    const usuariosSnap = await firestore.collection('usuarios').get();
    const passMap = new Map<string, string>(); // dni → pass
    for (const doc of usuariosSnap.docs) {
      const data = doc.data();
      const dni = String(data.dni ?? '').trim();
      const pass = String(data.pass ?? '').trim();
      if (dni && pass) passMap.set(dni, pass);
    }
    console.log(`   Usuarios con DNI+pass en Firestore: ${passMap.size}`);

    // 8. Leer cargas de Firestore (solo lectura)
    console.log('\n📥 Leyendo cargas de Firestore (solo lectura)...');
    const snapshot = await firestore.collection('cargas').get();
    const todasLasCargas: FirestoreCarga[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<FirestoreCarga, 'id'>),
    }));
    console.log(`   Documentos en "cargas": ${todasLasCargas.length}`);

    const empresasUnicas = [...new Set(todasLasCargas.map((c) => c.empresaId))];
    console.log(`   Empresas únicas: ${empresasUnicas.length}`);
    empresasUnicas.forEach((e) => {
      const cnt = todasLasCargas.filter((c) => c.empresaId === e).length;
      console.log(`     ${(e ?? '(sin empresaId)').padEnd(28)} ${cnt} cargas`);
    });

    console.log('\n─────────────────────────────────────────────────────────');

    // 9. Procesar cada carga
    let cargasInsertadas = 0;
    let cargasDuplicadas = 0;
    let vehiculosCreados = 0;
    let choferesCreados = 0;

    for (const carga of todasLasCargas) {
      const patenteNorm = normalizePatente(carga.licensePlate);
      const dniStr = String(carga.driverDni ?? '').trim();

      // ── Resolver / crear vehículo ──────────────────────────────────────────
      let vehiculoId: string | null = vehiculoMap.get(patenteNorm) ?? null;
      if (!vehiculoId) {
        if (!patenteNorm) {
          // Carga sin patente en Firestore → se migra con vehiculoId null en lugar de
          // crear un vehículo fantasma con patente vacía
          console.warn(
            `  ⚠️  Doc ${carga.id} sin licensePlate — la carga se migrará sin vehículo asociado`,
          );
        } else if (isDryRun) {
          console.log(`  [DRY] Crearía vehículo: ${patenteNorm} (tipo="otro")`);
          vehiculoId = `[nuevo:${patenteNorm}]`;
        } else {
          const v = await prisma.vehiculo.create({
            data: {
              tenantId,
              patente: patenteNorm,
              tipo: 'otro',
              marca: null,
              modelo: null,
              anio: null,
              kmActual: 0,
              transportistaId: null,
            },
          });
          vehiculoId = v.id;
          console.log(`  🚗 Vehículo creado: ${patenteNorm} → ${v.id}`);
          vehiculosCreados++;
        }
        if (patenteNorm && vehiculoId) vehiculoMap.set(patenteNorm, vehiculoId);
      }

      // ── Resolver / crear chofer ────────────────────────────────────────────
      let choferId = dniStr ? (choferMap.get(dniStr) ?? null) : null;
      const passRaw = dniStr ? (passMap.get(dniStr) ?? null) : null;
      const pinHash = passRaw && !isDryRun ? hashPin(passRaw) : null;

      if (!choferId && dniStr) {
        if (isDryRun) {
          console.log(`  [DRY] Crearía chofer: DNI ${dniStr} (${carga.driverName}) PIN: ${passRaw ? '✅' : '❌'}`);
          choferId = `[nuevo:${dniStr}]`;
        } else {
          const ch = await prisma.chofer.create({
            data: {
              tenantId,
              nombre: carga.driverName || `Chofer ${dniStr}`,
              dni: dniStr,
              pin: pinHash,
              licencia: null,
              licenciaVence: null,
              telefono: null,
              transportistaId: null,
            },
          });
          choferId = ch.id;
          console.log(`  👤 Chofer creado: DNI ${dniStr} "${carga.driverName}" PIN: ${pinHash ? '✅' : '❌'} → ${ch.id}`);
          choferesCreados++;
        }
        choferMap.set(dniStr, choferId);
      }

      // ── Dedup y carga ──────────────────────────────────────────────────────
      const fecha = resolveDate(carga.date);
      const litros = Number(carga.liters) || 0;
      const importe = Number(carga.totalAmount) || 0;

      // km: INT4 max = 2_147_483_647. Valor de Firestore fuera de rango → guardar 0 y avisar.
      const INT4_MAX = 2_147_483_647;
      const rawKm = Number(carga.kilometers) || 0;
      const km = rawKm > INT4_MAX ? 0 : Math.round(rawKm);
      if (rawKm > INT4_MAX) {
        console.warn(`  ⚠️  km fuera de rango INT4 (${rawKm}) en doc ${carga.id} — se guarda como 0`);
      }

      if (!isDryRun) {
        const diaInicio = startOfDay(fecha);
        const diaFin = new Date(diaInicio);
        diaFin.setUTCDate(diaFin.getUTCDate() + 1);

        const existente = await prisma.cargaCombustible.findFirst({
          where: { tenantId, vehiculoId, litros, km, fecha: { gte: diaInicio, lt: diaFin } },
        });
        if (existente) {
          cargasDuplicadas++;
          continue;
        }

        await prisma.cargaCombustible.create({
          data: {
            tenantId,
            vehiculoId,
            choferId,
            estacion: carga.serviceStation || 'OTRA',
            litros,
            importe,
            km,
            formaPago: carga.paymentMethod ?? null,
            fecha,
            createdBy: choferId ?? 'migration-bressan',
          },
        });
        const fechaStr = fecha.toISOString().slice(0, 10);
        console.log(`✅ ${fechaStr} | ${patenteNorm.padEnd(10)} | ${litros}L | $${importe}`);
      } else {
        const fechaStr = fecha.toISOString().slice(0, 10);
        console.log(
          `[DRY] ${fechaStr} | ${patenteNorm.padEnd(10)} | ${String(litros).padStart(7)}L` +
            ` | $${String(importe).padStart(10)} | ${carga.serviceStation ?? '?'}`,
        );
      }
      cargasInsertadas++;
    }

    // 10. Actualizar PIN de choferes ya existentes que no lo tenían
    let pinsActualizados = 0;
    for (const [dni, choferId] of choferMap.entries()) {
      if (!choferSinPin.has(choferId)) continue; // ya tenía PIN
      const passRaw = passMap.get(dni);
      if (!passRaw) continue; // no hay pass en Firestore para este dni
      if (isDryRun) {
        console.log(`  [DRY] Actualizaría PIN de chofer existente: DNI ${dni} (${choferId})`);
        pinsActualizados++;
      } else {
        await prisma.chofer.update({
          where: { id: choferId },
          data: { pin: hashPin(passRaw) },
        });
        console.log(`  🔑 PIN actualizado: DNI ${dni} → ${choferId}`);
        pinsActualizados++;
      }
    }

    // 11. Resumen final
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('📊 Resultado:');
    console.log(`   Total en Firestore:         ${todasLasCargas.length}`);
    console.log(`   Vehículos creados:          ${isDryRun ? '(dry run)' : vehiculosCreados}`);
    console.log(`   Choferes creados:           ${isDryRun ? '(dry run)' : choferesCreados}`);
    console.log(`   PINs migrados:              ${pinsActualizados}`);
    console.log(`   Cargas ${isDryRun ? 'a insertar  ' : 'insertadas  '}:      ${cargasInsertadas}`);
    console.log(`   Cargas duplicadas (salt.):  ${isDryRun ? '-' : cargasDuplicadas}`);

    if (isDryRun) {
      console.log('\n💡 Ejecutar sin --dry-run para aplicar los cambios en la BD.');
    } else {
      console.log('\n✅ Migración completada con éxito.');
    }
    console.log('══════════════════════════════════════════════════════════\n');
  } finally {
    await prisma.$disconnect();
    await deleteApp(firebaseApp);
  }
}

main().catch((e) => {
  console.error('\n❌ Error fatal:', e);
  process.exit(1);
});
