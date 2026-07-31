/**
 * TEST en HOMOLOGACIÓN: ¿se puede anular un CVLP (tipo 60) emitiendo una
 * Nota de Crédito de un tipo VÁLIDO de wsfev1, referenciando el 60 original?
 * Uso (desde vialto-backend):  node scripts/test-nc-sobre-cvlp.js
 * Sin impacto fiscal. Concepto 1 (Productos), como emite el sistema el CVLP.
 */
const fs = require('fs');
const path = require('path');
const Afip = require('@afipsdk/afip.js');

const CUIT_TEST = 20409378472;
const PTO_VTA = 1;

const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const val = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
};
const hoy = () => Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));

async function emitir(afip, tipo, cbtesAsoc, etiqueta) {
  const ultimo = await afip.ElectronicBilling.getLastVoucher(PTO_VTA, tipo);
  const nro = Number(ultimo) + 1;
  const data = {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: tipo, Concepto: 1, // 1 = Productos
    DocTipo: 80, DocNro: 30668346908,
    CbteDesde: nro, CbteHasta: nro, CbteFch: hoy(),
    ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpIVA: 21, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 1,
    Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
    ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
  };
  console.log(`\n=== ${etiqueta} (tipo ${tipo}) ===`);
  try {
    const res = await afip.ElectronicBilling.createVoucher(data);
    console.log(`  ✅ ACEPTADO. CAE: ${res.CAE}  Nro: ${nro}`);
    return { ok: true, nro };
  } catch (e) {
    console.log(`  ❌ RECHAZADO: ${e.message}`);
    if (e.data) console.log(`  DETALLE: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`);
    return { ok: false, nro };
  }
}

(async () => {
  const afip = new Afip({ CUIT: CUIT_TEST, access_token: val('AFIP_SDK_API_KEY'), production: false });
  console.log('Ambiente: HOMOLOGACIÓN (sin impacto fiscal).');

  const cvlp = await emitir(afip, 60, null, 'CVLP original (tipo 60)');
  if (!cvlp.ok) { console.log('\nNo se pudo emitir el 60 base; no se puede probar la NC.'); return; }

  const asoc = [{ Tipo: 60, PtoVta: PTO_VTA, Nro: cvlp.nro }];

  // Probamos varias Notas de Crédito válidas de wsfev1 asociadas al CVLP.
  const nc3 = await emitir(afip, 3, asoc, 'Nota de Crédito A (tipo 3) asociada al CVLP');
  let nc13 = { ok: false };
  if (!nc3.ok) nc13 = await emitir(afip, 13, asoc, 'Nota de Crédito C (tipo 13) asociada al CVLP');

  console.log('\n================ CONCLUSIÓN ================');
  if (nc3.ok) {
    console.log('AFIP ACEPTA una Nota de Crédito A (tipo 3) asociada al CVLP → ESTA es la vía automática.');
    console.log('Reimplementar la anulación emitiendo tipo 3 (u 8 para clase B) con CbtesAsoc al 60.');
  } else if (nc13.ok) {
    console.log('AFIP ACEPTA una Nota de Crédito C (tipo 13) asociada al CVLP → vía automática con tipo 13.');
  } else {
    console.log('Las NC estándar sobre el CVLP fueron rechazadas. Pedir a la competencia el TIPO exacto que usan.');
  }
})();
