/**
 * TEST en HOMOLOGACIÓN: ¿qué comprobantes acepta AFIP para anular un CVLP,
 * asociándolos (CbtesAsoc) al 060/061 original?
 * Uso (desde vialto-backend):  node scripts/test-anulacion-tipos.js
 * Sin impacto fiscal. Prueba los 4 candidatos del desplegable:
 *   Clase A (CVLP 60): Nota de Crédito A (3) y Nota de Débito A (2)
 *   Clase B (CVLP 61): Nota de Crédito B (8) y Nota de Débito B (7)
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

async function emitir(afip, tipo, condRec, cbtesAsoc, etiqueta) {
  const ultimo = await afip.ElectronicBilling.getLastVoucher(PTO_VTA, tipo);
  const nro = Number(ultimo) + 1;
  const data = {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: tipo, Concepto: 1,
    DocTipo: 80, DocNro: 30668346908,
    CbteDesde: nro, CbteHasta: nro, CbteFch: hoy(),
    ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpIVA: 21, ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: condRec,
    Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
    ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
  };
  try {
    const res = await afip.ElectronicBilling.createVoucher(data);
    console.log(`  ✅ ${etiqueta}: ACEPTADO (CAE ${res.CAE})`);
    return { ok: true, nro };
  } catch (e) {
    const det = e.data ? (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : e.message;
    console.log(`  ❌ ${etiqueta}: RECHAZADO — ${det}`);
    return { ok: false, nro };
  }
}

(async () => {
  const afip = new Afip({ CUIT: CUIT_TEST, access_token: val('AFIP_SDK_API_KEY'), production: false });
  console.log('Ambiente: HOMOLOGACIÓN (sin impacto fiscal).\n');
  const resultados = {};

  for (const clase of [
    { cvlp: 60, letra: 'A', nc: 3, nd: 2, condRecs: [1] },
    { cvlp: 61, letra: 'B', nc: 8, nd: 7, condRecs: [6, 4, 5, 10, 13, 7] },
  ]) {
    console.log(`--- CVLP clase ${clase.letra} (tipo ${clase.cvlp}) ---`);
    let base = null, condRec = null;
    for (const cr of clase.condRecs) {
      const r = await emitir(afip, clase.cvlp, cr, null, `CVLP ${clase.cvlp} original (CondIVARec ${cr})`);
      if (r.ok) { base = r; condRec = cr; break; }
    }
    if (!base) { console.log('  (no salió el CVLP base con ninguna Condición IVA receptor; se saltea)\n'); continue; }
    const asoc = [{ Tipo: clase.cvlp, PtoVta: PTO_VTA, Nro: base.nro }];

    const nc = await emitir(afip, clase.nc, condRec, asoc, `Nota de Crédito ${clase.letra} (tipo ${clase.nc})`);
    const nd = await emitir(afip, clase.nd, condRec, asoc, `Nota de Débito ${clase.letra} (tipo ${clase.nd})`);
    resultados[`NC ${clase.letra} (${clase.nc})`] = nc.ok;
    resultados[`ND ${clase.letra} (${clase.nd})`] = nd.ok;
    console.log('');
  }

  console.log('================ RESUMEN (qué poner en el desplegable) ================');
  for (const [k, ok] of Object.entries(resultados)) {
    console.log(`  ${ok ? '✅ ACEPTA' : '❌ RECHAZA'}  ${k}`);
  }
})();
