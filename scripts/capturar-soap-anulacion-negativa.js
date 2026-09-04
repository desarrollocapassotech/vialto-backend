/**
 * capturar-soap-anulacion-negativa.js
 * ---------------------------------------------------------------------------
 * OBJETIVO: obtener el ENVOLTORIO SOAP completo (request + response) de un
 * intento de emisión de CVLP código 60 con importes en NEGATIVO — que es lo
 * que ARCA (sri@arca.gob.ar) pidió para analizar el caso de NyM.
 *
 * afipsdk NO guarda ni expone el SOAP crudo (su panel solo loguea metadata),
 * así que lo capturamos nosotros: usamos afipsdk únicamente para obtener el
 * Token/Sign de WSAA (evita implementar la firma CMS y no choca con la sesión),
 * y armamos + enviamos el FECAESolicitar DIRECTO al web service de AFIP,
 * guardando el XML que se envía y el XML que AFIP devuelve.
 *
 * SEGURIDAD: AFIP rechaza el importe negativo (error 10065 / 10020). Al ser
 * rechazado NO se genera comprobante ni se consume número. Seguro en producción.
 * El script NO modifica la base de datos.
 *
 * USO:
 *   cd vialto-backend
 *   node scripts/capturar-soap-anulacion-negativa.js "VIAJE DE PRUEBA"
 *
 * SALIDA: crea la carpeta scripts/soap-output/ con:
 *   - request-FECAESolicitar.xml   (lo que se envía a AFIP)
 *   - response-FECAESolicitar.xml  (lo que AFIP devuelve, con el error)
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

// ── Carga .env sin depender de 'dotenv' ──────────────────────────────────────
(function loadEnv() {
  for (const p of [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '..', '.env')]) {
    try {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
      break;
    } catch { /* seguir */ }
  }
})();

const { PrismaClient } = require('@prisma/client');
const Afip = require('@afipsdk/afip.js');

const NS = 'http://ar.gov.afip.dif.FEV1/';
const ENDPOINTS = {
  produccion: ['https://servicios1.afip.gov.ar/wsfev1/service.asmx', 'https://servicios1.afip.gob.ar/wsfev1/service.asmx'],
  homologacion: ['https://wswhomo.afip.gov.ar/wsfev1/service.asmx', 'https://wswhomo.afip.gob.ar/wsfev1/service.asmx'],
};

function normalizePem(pem) {
  if (!pem) return pem;
  return pem.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}
function normalizeAmbiente(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'produccion' || v === 'production' || v === 'prod' ? 'produccion' : 'homologacion';
}
function ivaIdFromPct(pct) {
  switch (Number(pct)) { case 0: return 3; case 10.5: return 4; case 21: return 5; case 27: return 6; default: return 5; }
}
function fechaYmd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEnvelope({ token, sign, cuit, ptoVenta, cbteNro, docTipo, docNro, condIva, fecha, impTotal, impNeto, impIva, ivaId, asoc }) {
  const ivaBlock = impIva !== 0
    ? `\n          <ar:Iva><ar:AlicIva><ar:Id>${ivaId}</ar:Id><ar:BaseImp>${impNeto.toFixed(2)}</ar:BaseImp><ar:Importe>${impIva.toFixed(2)}</ar:Importe></ar:AlicIva></ar:Iva>`
    : '';
  const asocBlock = asoc
    ? `\n          <ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${asoc.tipo}</ar:Tipo><ar:PtoVta>${asoc.ptoVta}</ar:PtoVta><ar:Nro>${asoc.nro}</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soap:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${esc(token)}</ar:Token>
        <ar:Sign>${esc(sign)}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVenta}</ar:PtoVta>
          <ar:CbteTipo>60</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${docTipo}</ar:DocTipo>
            <ar:DocNro>${docNro}</ar:DocNro>
            <ar:CbteDesde>${cbteNro}</ar:CbteDesde>
            <ar:CbteHasta>${cbteNro}</ar:CbteHasta>
            <ar:CbteFch>${fecha}</ar:CbteFch>
            <ar:ImpTotal>${impTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpIVA>${impIva.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>${condIva}</ar:CondicionIVAReceptorId>${asocBlock}${ivaBlock}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`;
}

async function postSoap(urls, body) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': `${NS}FECAESolicitar`,
        },
        body,
      });
      const text = await res.text();
      return { url, status: res.status, text };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function main() {
  const NUMERO_VIAJE = process.argv[2] || 'VIAJE DE PRUEBA';
  const prisma = new PrismaClient();

  console.log('Buscando viaje / liquidación...');
  const viaje = await prisma.viaje.findFirst({
    where: { OR: [{ numero: NUMERO_VIAJE }, { numeroIdentificacionPersonalizado: NUMERO_VIAJE }] },
  });
  if (!viaje) throw new Error(`No se encontró el viaje "${NUMERO_VIAJE}".`);

  const liq = await prisma.liquidacion.findFirst({
    where: { viajes: { some: { viajeId: viaje.id } } },
    orderBy: { createdAt: 'desc' },
    include: { transportista: true },
  });
  if (!liq) throw new Error('El viaje no tiene liquidación asociada.');

  const config = await prisma.arcaConfig.findFirst({ where: { tenantId: liq.tenantId } });
  if (!config) throw new Error('No hay ArcaConfig para el tenant.');

  const ambiente = normalizeAmbiente(config.ambiente);
  const production = ambiente === 'produccion';
  const apiKey = process.env.AFIP_SDK_API_KEY;
  if (!apiKey) throw new Error('Falta AFIP_SDK_API_KEY en el .env');

  const cuit = production ? String(config.cuitEmisor).replace(/[-\s]/g, '') : '20409378472';
  const ptoVenta = production ? config.ptoVentaCvlp : 1;

  console.log(`Liquidación ${liq.id} | ambiente=${ambiente} | CUIT=${cuit} | ptoVenta=${ptoVenta}`);
  console.log(`Importes originales: total=${liq.liquido} iva=${liq.gastosAdminIva} ivaPct=${liq.ivaPct}`);

  // ── Afip client (solo para obtener Token/Sign vía afipsdk) ──────────────────
  const afipOpts = { CUIT: cuit, access_token: apiKey, production };
  if (production) {
    const cert = process.env.AFIP_SDK_CERT ? normalizePem(process.env.AFIP_SDK_CERT) : null;
    const key = process.env.AFIP_SDK_KEY ? normalizePem(process.env.AFIP_SDK_KEY) : null;
    if (!cert || !key) throw new Error('Falta AFIP_SDK_CERT / AFIP_SDK_KEY en el .env');
    afipOpts.cert = cert;
    afipOpts.key = key;
  }
  const afip = new Afip(afipOpts);

  console.log('Obteniendo Token/Sign (WSAA vía afipsdk)...');
  const ta = await afip.ElectronicBilling.getTokenAuthorization();

  console.log('Consultando último comprobante autorizado (código 60)...');
  let cbteNro = 1;
  try {
    const last = await afip.ElectronicBilling.getLastVoucher(ptoVenta, 60);
    cbteNro = Number(last) + 1;
  } catch (e) {
    console.log(`  (no se pudo obtener último nro, uso ${cbteNro}): ${e.message}`);
  }

  // ── Importes en NEGATIVO ────────────────────────────────────────────────────
  const impTotal = -(Math.round(liq.liquido * 100) / 100);
  const impIva = -(Math.round((liq.gastosAdminIva || 0) * 100) / 100);
  const impNeto = -(Math.round((liq.liquido - (liq.gastosAdminIva || 0)) * 100) / 100);

  const docNroReal = liq.transportista?.idFiscal ? Number(String(liq.transportista.idFiscal).replace(/-/g, '')) : 0;
  const docTipo = production ? (docNroReal ? 80 : 99) : 80;
  const docNro = production ? docNroReal : 30668346908;
  const condIva = production ? (liq.transportista?.condicionIva ?? 1) : 1;

  const envelope = buildEnvelope({
    token: ta.token, sign: ta.sign, cuit,
    ptoVenta, cbteNro, docTipo, docNro, condIva,
    fecha: fechaYmd(),
    impTotal, impNeto, impIva, ivaId: ivaIdFromPct(liq.ivaPct),
    asoc: (liq.cbteNro && liq.ptoVenta) ? { tipo: 60, ptoVta: liq.ptoVenta, nro: liq.cbteNro } : null,
  });

  const outDir = path.resolve(__dirname, 'soap-output');
  fs.mkdirSync(outDir, { recursive: true });
  const reqPath = path.join(outDir, 'request-FECAESolicitar.xml');
  fs.writeFileSync(reqPath, envelope, 'utf8');
  console.log(`\n✔ Request SOAP guardado: ${reqPath}`);

  console.log('Enviando FECAESolicitar directo a AFIP...');
  const { url, status, text } = await postSoap(ENDPOINTS[ambiente], envelope);
  const respPath = path.join(outDir, 'response-FECAESolicitar.xml');
  fs.writeFileSync(respPath, text, 'utf8');
  console.log(`✔ Response SOAP guardado: ${respPath}`);
  console.log(`  Endpoint: ${url}  (HTTP ${status})`);

  // Extraer mensajes de error para mostrar en consola
  const errs = [...text.matchAll(/<Code>(\d+)<\/Code>\s*<Msg>([^<]*)<\/Msg>/g)];
  if (errs.length) {
    console.log('\nErrores devueltos por AFIP (esperado):');
    for (const [, c, m] of errs) console.log(`  [${c}] ${m}`);
  } else if (/<CAE>\d/.test(text)) {
    console.log('\n⚠️  ATENCIÓN: AFIP devolvió un CAE (inesperado). Revisá si se generó comprobante.');
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(' LISTO. Adjuntá a ARCA estos dos archivos (envoltorio SOAP completo):');
  console.log(`   ${reqPath}`);
  console.log(`   ${respPath}`);
  console.log('════════════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch((e) => { console.error('\n❌ ERROR:', e.message); process.exit(1); });
