/**
 * Lista los tipos de comprobante válidos en AFIP (FEParamGetTiposCbte).
 * Uso (desde vialto-backend):  node scripts/consultar-tipos-comprobante.js
 * Lee las credenciales de .env (AFIP_SDK_API_KEY / AFIP_SDK_CERT / AFIP_SDK_KEY).
 * Es de solo lectura: NO emite ningún comprobante.
 */
const fs = require('fs');
const path = require('path');
const Afip = require('@afipsdk/afip.js');

const CUIT = 30716741792; // CUIT emisor (NyM)

const envPath = path.resolve(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
function val(name) {
  const m = env.match(new RegExp('^' + name + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
}

(async () => {
  try {
    const afip = new Afip({
      CUIT,
      access_token: val('AFIP_SDK_API_KEY'),
      production: true,
      cert: val('AFIP_SDK_CERT'),
      key: val('AFIP_SDK_KEY'),
    });
    const tipos = await afip.ElectronicBilling.getVoucherTypes();
    const lista = Array.isArray(tipos) ? tipos : [tipos];
    console.log('Tipos de comprobante válidos (producción):');
    for (const t of lista) {
      console.log(`  ${t.Id}\t${t.Desc}`);
    }
    console.log('\n--- Relacionados con liquidaciones / CVLP ---');
    for (const t of lista) {
      const d = String(t.Desc || '').toLowerCase();
      if (d.includes('liquid') || d.includes('cuenta de venta') || d.includes('cvlp')) {
        console.log(`  ${t.Id}\t${t.Desc}`);
      }
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    if (e.data) console.log('DETALLE:', typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
  }
})();
