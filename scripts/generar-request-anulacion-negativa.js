/**
 * generar-request-anulacion-negativa.js
 * ---------------------------------------------------------------------------
 * OBJETIVO: reproducir por web service (afipsdk) la emisión de un CVLP código 60
 * con importes en NEGATIVO — que es lo que ARCA le indicó a NyM para anular —
 * de modo que la request/response SOAP quede registrada en el panel de afipsdk
 * (app.afipsdk.com/requests) y puedas descargarla para adjuntarla al ticket de
 * sri@arca.gob.ar.
 *
 * IMPORTANTE / SEGURIDAD:
 *  - AFIP RECHAZA el importe negativo con el error 10065 ("ImpTotal no puede ser
 *    menor a cero"). Al ser rechazado, NO se genera ningún comprobante ni se
 *    consume número. Por eso es seguro incluso en producción.
 *  - El script NO modifica la base de datos ni la liquidación. Solo lee datos y
 *    dispara el request contra AFIP para que afipsdk lo loguee.
 *
 * USO:
 *   cd vialto-backend
 *   node scripts/generar-request-anulacion-negativa.js "VIAJE DE PRUEBA"
 *   (si no se pasa argumento, usa "VIAJE DE PRUEBA" por defecto)
 *
 * REQUISITOS (mismas variables que usa el backend, tomadas de .env):
 *   - DATABASE_URL
 *   - ARCA_ENCRYPTION_KEY   (para descifrar cert/key de producción)
 *   - AFIP_SDK_API_KEY      (access_token de afipsdk)
 * ---------------------------------------------------------------------------
 */
// Carga .env sin depender del paquete 'dotenv' (que puede no estar instalado).
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  for (const p of [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
  ]) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2];
        // Quitar comillas envolventes si las hay
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[m[1]] === undefined) process.env[m[1]] = val;
      }
      break;
    } catch { /* seguir */ }
  }
})();

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const Afip = require('@afipsdk/afip.js');

// ── Constantes replicadas de arca.util.ts ───────────────────────────────────
const CUIT_TEST_HOMOLOGACION = '20409378472';
const CUIT_RECEPTOR_TEST_HOMOLOGACION = 30668346908;
const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CF = 99;

// ── Descifrado (replica shared/util/arca-crypto.ts) ──────────────────────────
const GCM = 'aes-256-gcm';
const CBC = 'aes-256-cbc';
function encKey() {
  const k = process.env.ARCA_ENCRYPTION_KEY;
  if (!k) throw new Error('Falta ARCA_ENCRYPTION_KEY en el .env');
  return crypto.createHash('sha256').update(k).digest();
}
function isEncrypted(t) {
  return /^[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(t) ||
    /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(t);
}
function decryptField(text) {
  if (!text) return null;
  if (!isEncrypted(text)) return text;
  const p = text.split(':');
  if (p.length === 3 && p[0].length === 24 && p[1].length === 32) {
    const d = crypto.createDecipheriv(GCM, encKey(), Buffer.from(p[0], 'hex'));
    d.setAuthTag(Buffer.from(p[1], 'hex'));
    return d.update(p[2], 'hex', 'utf8') + d.final('utf8');
  }
  if (p.length === 2 && p[0].length === 32) {
    const d = crypto.createDecipheriv(CBC, encKey(), Buffer.from(p[0], 'hex'));
    return d.update(p[1], 'hex', 'utf8') + d.final('utf8');
  }
  throw new Error('Formato de cifrado desconocido');
}
function normalizePem(pem) {
  if (!pem) return pem;
  return pem.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizeAmbiente(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'produccion' || v === 'production' || v === 'prod' ? 'produccion' : 'homologacion';
}
function ivaIdFromPct(pct) {
  switch (Number(pct)) {
    case 0: return 3;
    case 10.5: return 4;
    case 21: return 5;
    case 27: return 6;
    default: return 5;
  }
}
function fechaYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return Number(`${y}${m}${day}`);
}

async function main() {
  const NUMERO_VIAJE = process.argv[2] || 'VIAJE DE PRUEBA';
  const prisma = new PrismaClient();

  console.log('════════════════════════════════════════════════════════════════');
  console.log(' Reproducir request de anulación CVLP (código 60) en NEGATIVO');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(`Buscando viaje: "${NUMERO_VIAJE}"...`);

  const viaje = await prisma.viaje.findFirst({
    where: {
      OR: [
        { numero: NUMERO_VIAJE },
        { numeroIdentificacionPersonalizado: NUMERO_VIAJE },
      ],
    },
  });
  if (!viaje) throw new Error(`No se encontró ningún viaje con número "${NUMERO_VIAJE}".`);
  console.log(`  ✔ Viaje ${viaje.id} (tenant ${viaje.tenantId})`);

  const liq = await prisma.liquidacion.findFirst({
    where: { viajes: { some: { viajeId: viaje.id } } },
    orderBy: { createdAt: 'desc' },
    include: { transportista: true },
  });
  if (!liq) throw new Error('El viaje no tiene ninguna liquidación asociada.');
  console.log(`  ✔ Liquidación ${liq.id} — estado=${liq.estado}, cbteTipo=${liq.cbteTipo}, ` +
    `cbteNro=${liq.cbteNro ?? '—'}, ptoVenta=${liq.ptoVenta ?? '—'}`);
  console.log(`     liquido=${liq.liquido}  gastosAdminIva(impIva)=${liq.gastosAdminIva}  ivaPct=${liq.ivaPct}`);

  const config = await prisma.arcaConfig.findFirst({ where: { tenantId: liq.tenantId } });
  if (!config) throw new Error('No hay ArcaConfig para el tenant de la liquidación.');

  const ambiente = normalizeAmbiente(config.ambiente);
  const production = ambiente === 'produccion';
  const apiKey = process.env.AFIP_SDK_API_KEY;
  if (!apiKey) throw new Error('Falta AFIP_SDK_API_KEY en el .env');

  console.log(`\n  Ambiente configurado: ${ambiente.toUpperCase()} ` +
    `(entorno afipsdk: ${production ? 'Producción' : 'Desarrollo'})`);

  // ── Certificado / CUIT según ambiente ──────────────────────────────────────
  const cuitForSdk = production ? String(config.cuitEmisor).replace(/[-\s]/g, '') : CUIT_TEST_HOMOLOGACION;
  const afipOpts = { CUIT: cuitForSdk, access_token: apiKey, production };
  if (production) {
    // Preferimos el cert/clave en texto plano del .env (AFIP_SDK_CERT / AFIP_SDK_KEY),
    // que evita el mismatch de ARCA_ENCRYPTION_KEY entre entornos. Si no están,
    // caemos al valor cifrado guardado en ArcaConfig.
    let cert = process.env.AFIP_SDK_CERT ? normalizePem(process.env.AFIP_SDK_CERT) : null;
    let key = process.env.AFIP_SDK_KEY ? normalizePem(process.env.AFIP_SDK_KEY) : null;
    let fuente = 'env (.env)';
    if (!cert || !key) {
      cert = normalizePem(decryptField(config.certPemProduccion));
      key = normalizePem(decryptField(config.keyPemProduccion));
      fuente = 'base (descifrado)';
    }
    if (!cert || !key) throw new Error('No se encontró certificado/clave de producción (ni en .env ni en la base).');
    afipOpts.cert = cert;
    afipOpts.key = key;
    console.log(`  Certificado/clave de producción: origen = ${fuente}`);
  }

  // ── Punto de venta y receptor (replica findWithApiKey + resolveReceptorAfip) ─
  const ptoVenta = production ? config.ptoVentaCvlp : 1;
  const condIva = liq.transportista?.condicionIva ?? 1;
  const docNroReal = liq.transportista?.idFiscal
    ? Number(String(liq.transportista.idFiscal).replace(/-/g, ''))
    : 0;

  let receptor;
  if (production) {
    receptor = { docTipo: docNroReal ? DOC_TIPO_CUIT : DOC_TIPO_CF, docNro: docNroReal, cond: condIva };
  } else {
    // Homologación clase A → CUIT de prueba
    receptor = { docTipo: DOC_TIPO_CUIT, docNro: CUIT_RECEPTOR_TEST_HOMOLOGACION, cond: 1 };
  }

  // ── Importes en NEGATIVO ────────────────────────────────────────────────────
  const impTotal = Math.round(liq.liquido * 100) / 100;
  const impIva = Math.round((liq.gastosAdminIva || 0) * 100) / 100;
  const impNeto = Math.round((impTotal - impIva) * 100) / 100;

  const data = {
    CantReg: 1,
    PtoVta: ptoVenta,
    CbteTipo: 60,
    Concepto: 1,
    DocTipo: receptor.docTipo,
    DocNro: receptor.docNro,
    CbteFch: fechaYmd(),
    ImpTotal: -impTotal,
    ImpTotConc: 0,
    ImpNeto: -impNeto,
    ImpOpEx: 0,
    ImpIVA: -impIva,
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: receptor.cond,
  };
  if (impIva !== 0) {
    data.Iva = [{ Id: ivaIdFromPct(liq.ivaPct), BaseImp: -impNeto, Importe: -impIva }];
  }
  // Asociar al CVLP original si está autorizado (para que sea una anulación fiel)
  if (liq.cbteNro && liq.ptoVenta) {
    data.CbtesAsoc = [{ Tipo: 60, PtoVta: liq.ptoVenta, Nro: liq.cbteNro }];
  }

  console.log('\n── Request que se enviará a AFIP (código 60 en negativo) ──────────');
  console.log(JSON.stringify(data, null, 2));
  console.log('──────────────────────────────────────────────────────────────────\n');

  const afip = new Afip(afipOpts);

  try {
    console.log('Enviando FECAESolicitar vía afipsdk (createNextVoucher)...\n');
    const res = await afip.ElectronicBilling.createNextVoucher(data);
    // Si por algún motivo AFIP lo aceptara (no debería), lo avisamos fuerte:
    console.log('⚠️  ATENCIÓN: AFIP ACEPTÓ el comprobante negativo (inesperado):');
    console.log(JSON.stringify(res, null, 2));
    console.log('\n⚠️  Revisá en AFIP si se generó un comprobante real.');
  } catch (err) {
    console.log('✔ AFIP rechazó el comprobante (esperado). Detalle:\n');
    const detail = err?.message ?? String(err);
    console.log(detail);
    const respData = err?.response?.data ?? err?.data;
    if (respData) {
      console.log('\nRespuesta cruda de afipsdk:');
      console.log(typeof respData === 'string' ? respData : JSON.stringify(respData, null, 2));
    }
    console.log('\n(El rechazo confirma que no se generó ningún comprobante.)');
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(' LISTO. Ahora, para obtener el SOAP:');
  console.log(' 1. Entrá a https://app.afipsdk.com/requests');
  console.log(` 2. Poné el filtro Entorno = "${production ? 'Producción' : 'Desarrollo'}"`);
  console.log(' 3. Buscá la request FECAESolicitar más reciente (recién generada)');
  console.log(' 4. Abrila y descargá/copiá el request y response SOAP');
  console.log('════════════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('\n❌ ERROR:', e.message);
  process.exit(1);
});
