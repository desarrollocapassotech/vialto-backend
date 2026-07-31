/**
 * Aísla el error cms.sign.invalid: prueba SOLO la autenticación WSAA en producción
 * con el certificado del .env (el mismo que usa el sistema).
 * Uso (desde vialto-backend):  node scripts/test-auth.js
 * Solo lectura, no emite nada.
 */
const fs = require('fs');
const path = require('path');
const Afip = require('@afipsdk/afip.js');

const CUIT = 30716741792;
const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const val = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
};

(async () => {
  try {
    const afip = new Afip({
      CUIT,
      access_token: val('AFIP_SDK_API_KEY'),
      production: true,
      cert: val('AFIP_SDK_CERT'),
      key: val('AFIP_SDK_KEY'),
    });
    // getSalesPoints requiere autenticación WSAA: si la firma falla, salta acá.
    const pv = await afip.ElectronicBilling.getSalesPoints();
    console.log('✅ Autenticación WSAA OK. Puntos de venta:', JSON.stringify(pv));
    console.log('   → El certificado y la firma funcionan. El error del sistema puede ser el cert guardado en la base (re-cargalo) o algo puntual.');
  } catch (e) {
    console.log('❌ Falló la autenticación:', e.message);
    if (e.data) console.log('   DETALLE:', typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    console.log('   → Si dice cms.sign.invalid, el problema es de AFIP/afipsdk (no tu código): reintentá en unos minutos o revisá el estado de afipsdk.com.');
  }
})();
