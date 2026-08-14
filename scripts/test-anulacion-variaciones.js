/**
 * TEST en HOMOLOGACIÓN: barrido de variaciones para intentar un "ajuste/anulación
 * en negativo" que AFIP acepte por WSFEv1. Sin impacto fiscal.
 * Uso (desde vialto-backend):  node scripts/test-anulacion-variaciones.js
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

let afip;
async function siguienteNro(tipo) {
  const u = await afip.ElectronicBilling.getLastVoucher(PTO_VTA, tipo);
  return Number(u) + 1;
}
async function probar(etiqueta, tipo, build) {
  const nro = await siguienteNro(tipo);
  const data = {
    CantReg: 1, PtoVta: PTO_VTA, CbteTipo: tipo, Concepto: 1,
    DocTipo: 80, DocNro: 30668346908,
    CbteDesde: nro, CbteHasta: nro, CbteFch: hoy(),
    MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 1,
    ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0,
    ...build(),
  };
  try {
    const res = await afip.ElectronicBilling.createVoucher(data);
    console.log(`  ✅ ${etiqueta}: ACEPTADO (CAE ${res.CAE})`);
    return true;
  } catch (e) {
    const det = e.data ? (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : e.message;
    console.log(`  ❌ ${etiqueta}: ${det}`);
    return false;
  }
}

(async () => {
  afip = new Afip({ CUIT: CUIT_TEST, access_token: val('AFIP_SDK_API_KEY'), production: false });
  console.log('Ambiente: HOMOLOGACIÓN (sin impacto fiscal).\n');
  const R = {};

  console.log('--- Familia liquidaciones en negativo ---');
  R['Liquidación A (63) negativa'] = await probar('Liquidación A (63) negativa', 63, () => ({
    ImpTotal: -121, ImpNeto: -100, ImpIVA: -21, Iva: [{ Id: 5, BaseImp: -100, Importe: -21 }],
  }));
  R['Liquidación B (64) negativa'] = await probar('Liquidación B (64) negativa', 64, () => ({
    ImpTotal: -121, ImpNeto: -100, ImpIVA: -21, Iva: [{ Id: 5, BaseImp: -100, Importe: -21 }],
  }));

  console.log('\n--- Código 60 con Concepto 2 (Servicios) en negativo ---');
  R['CVLP 60 neg, Concepto 2 (servicios)'] = await probar('CVLP 60 neg, Concepto 2', 60, () => ({
    Concepto: 2,
    FchServDesde: hoy(), FchServHasta: hoy(), FchVtoPago: hoy(),
    ImpTotal: -121, ImpNeto: -100, ImpIVA: -21, Iva: [{ Id: 5, BaseImp: -100, Importe: -21 }],
  }));

  console.log('\n--- Caracterización de la validación ---');
  R['CVLP 60 con ImpTotal = 0'] = await probar('CVLP 60 con total 0', 60, () => ({
    ImpTotal: 0, ImpNeto: 0, ImpIVA: 0, Iva: [{ Id: 3, BaseImp: 0, Importe: 0 }],
  }));

  console.log('\n================ RESUMEN ================');
  for (const [k, ok] of Object.entries(R)) console.log(`  ${ok ? '✅ ACEPTA' : '❌ RECHAZA'}  ${k}`);
  console.log('\nSi todas dan RECHAZA, el negativo por WSFEv1 está descartado y queda la respuesta de ARCA / la NC-ND.');
})();
