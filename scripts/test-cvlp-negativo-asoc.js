/**
 * TEST en HOMOLOGACIÓN: ¿AFIP acepta un código 60 NEGATIVO si va ASOCIADO
 * (CbtesAsoc) al código 60 original? (la vía que sugiere ARCA: mismo comprobante
 * en negativo, probado ahora como ajuste asociado).
 * Uso (desde vialto-backend):  node scripts/test-cvlp-negativo-asoc.js
 * Sin impacto fiscal. Probamos varias formas del negativo por si alguna pasa.
 */
const fs = require('fs');
const path = require('path');
const Afip = require('@afipsdk/afip.js');

const CUIT_TEST = 20409378472;
const PTO_VTA = 1;
const CBTE_TIPO = 60;

const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const val = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
};
const hoy = () => Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));

async function emitir(afip, data, etiqueta) {
  console.log(`\n=== ${etiqueta} ===`);
  try {
    const res = await afip.ElectronicBilling.createVoucher(data);
    console.log(`  ✅ ACEPTADO. CAE: ${res.CAE}`);
    return { ok: true, nro: data.CbteDesde };
  } catch (e) {
    const det = e.data ? (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : e.message;
    console.log(`  ❌ RECHAZADO — ${det}`);
    return { ok: false };
  }
}

function base(nro, signo, extra = {}) {
  const neto = signo * 100, iva = signo * 21, total = signo * 121;
  return {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: CBTE_TIPO, Concepto: 1,
    DocTipo: 80, DocNro: 30668346908,
    CbteDesde: nro, CbteHasta: nro, CbteFch: hoy(),
    ImpTotal: total, ImpTotConc: 0, ImpNeto: neto, ImpOpEx: 0, ImpIVA: iva, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 1,
    Iva: [{ Id: 5, BaseImp: neto, Importe: iva }],
    ...extra,
  };
}

(async () => {
  const afip = new Afip({ CUIT: CUIT_TEST, access_token: val('AFIP_SDK_API_KEY'), production: false });
  console.log('Ambiente: HOMOLOGACIÓN (sin impacto fiscal).');

  // 1) Código 60 POSITIVO original
  let ultimo = await afip.ElectronicBilling.getLastVoucher(PTO_VTA, CBTE_TIPO);
  const nroOrig = Number(ultimo) + 1;
  const orig = await emitir(afip, base(nroOrig, +1), `Código 60 ORIGINAL (positivo) nro ${nroOrig}`);
  if (!orig.ok) { console.log('\nNo se pudo emitir el 60 original; se corta.'); return; }

  const asoc = [{ Tipo: CBTE_TIPO, PtoVta: PTO_VTA, Nro: nroOrig }];

  // 2) Código 60 NEGATIVO asociado al original
  ultimo = await afip.ElectronicBilling.getLastVoucher(PTO_VTA, CBTE_TIPO);
  const r2 = await emitir(
    afip,
    base(Number(ultimo) + 1, -1, { CbtesAsoc: asoc }),
    'Código 60 NEGATIVO asociado al original (CbtesAsoc)',
  );

  console.log('\n================ CONCLUSIÓN ================');
  if (r2.ok) {
    console.log('AFIP ACEPTA el código 60 negativo asociado → esa es la vía que indica ARCA. Reimplementamos la anulación así.');
  } else {
    console.log('AFIP rechaza el 60 negativo incluso asociado → por web service no se puede; queda esperar la respuesta de sri@arca.gob.ar (o hacerlo manual / con NC-ND).');
  }
})();
