/**
 * TEST en HOMOLOGACIÓN: ¿wsfev1 acepta emitir un CbteTipo 65 (la "NC 065")?
 * Replica EXACTAMENTE el código que sugiere la IA de Google.
 * Uso (desde vialto-backend):  node scripts/test-tipo65.js
 *
 * - Ambiente: HOMOLOGACIÓN (production: false). Sin impacto fiscal.
 * - 1) Muestra si el tipo 65 figura en la lista oficial de AFIP (FEParamGetTiposCbte).
 * - 2) Intenta emitir el 65 con CbtesAsoc, igual que el ejemplo de la IA.
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

(async () => {
  const afip = new Afip({ CUIT: CUIT_TEST, access_token: val('AFIP_SDK_API_KEY'), production: false });

  // 1) ¿El tipo 65 existe en la lista oficial de wsfev1?
  console.log('=== 1) ¿Figura el tipo 65 en FEParamGetTiposCbte? ===');
  try {
    const tipos = await afip.ElectronicBilling.getVoucherTypes();
    const lista = Array.isArray(tipos) ? tipos : [tipos];
    const t65 = lista.find((x) => Number(x.Id) === 65);
    console.log(t65 ? `  Sí: ${JSON.stringify(t65)}` : '  NO. wsfev1 no soporta el tipo 65.');
    console.log('  Tipos de la familia liquidaciones disponibles:',
      lista.filter((x) => [60, 61, 63, 64, 65, 66].includes(Number(x.Id))).map((x) => `${x.Id}=${x.Desc}`).join(' | '));
  } catch (e) {
    console.log('  ERROR consultando tipos:', e.message);
  }

  // 2) Intento de emisión del 65 (código equivalente al que sugiere la IA).
  console.log('\n=== 2) Intento de emitir CbteTipo 65 con CbtesAsoc (código de la IA) ===');
  try {
    const res = await afip.ElectronicBilling.createVoucher({
      CbteTipo: 65,
      PtoVta: PTO_VTA,
      Concepto: 2,
      DocTipo: 80,
      DocNro: 30668346908,
      CbteFch: hoy(),
      ImpTotal: 121,
      ImpTotConc: 0,
      ImpNeto: 100,
      ImpOpEx: 0,
      ImpIVA: 21,
      ImpTrib: 0,
      MonId: 'PES',
      MonCotiz: 1,
      CbtesAsoc: [{ Tipo: 60, PtoVta: PTO_VTA, Nro: 1 }],
      Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
    });
    console.log('  ✅ ACEPTADO. CAE:', res.CAE, ' → la IA tendría razón, el 65 se puede emitir por wsfev1.');
  } catch (e) {
    console.log('  ❌ RECHAZADO por AFIP:', e.message);
    if (e.data) console.log('  DETALLE:', typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    console.log('  → Confirmado: wsfev1 NO acepta el tipo 65 (mismo error que en producción).');
  }
})();
