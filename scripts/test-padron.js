/**
 * Prueba la consulta al padrón de ARCA (ws_sr_constancia_inscripcion) con el
 * certificado de plataforma. Solo lectura, consume 1 request de afipsdk.
 *
 * Uso (desde vialto-backend):  node scripts/test-padron.js [CUIT a consultar]
 * Sin argumento consulta el propio PADRON_CUIT.
 * Cert/key: PADRON_CERT/PADRON_KEY del .env, o si no están, scripts/.padron-cert/.
 */
const fs = require('fs');
const path = require('path');
const Afip = require('@afipsdk/afip.js');

const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const val = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
};
const fromFile = (f) => {
  const p = path.resolve(__dirname, '.padron-cert', f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

(async () => {
  const cuitPlataforma = val('PADRON_CUIT');
  const cert = val('PADRON_CERT') ?? fromFile('vialtopadron.crt');
  const key = val('PADRON_KEY') ?? fromFile('vialtopadron.key');
  const consultado = (process.argv[2] ?? cuitPlataforma ?? '').replace(/\D/g, '');

  if (!cuitPlataforma || !cert || !key || !val('PADRON_AFIP_SDK_API_KEY')) {
    console.log('❌ Faltan PADRON_CUIT / PADRON_AFIP_SDK_API_KEY en .env, o cert/key.');
    process.exit(1);
  }

  try {
    const afip = new Afip({
      CUIT: Number(cuitPlataforma),
      access_token: val('PADRON_AFIP_SDK_API_KEY'),
      production: true,
      cert,
      key,
    });
    const persona = await afip.RegisterInscriptionProof.getTaxpayerDetails(Number(consultado));
    if (!persona) {
      console.log(`⚠️  El CUIT ${consultado} no existe en el padrón.`);
      return;
    }
    const dg = persona.datosGenerales ?? {};
    const dom = dg.domicilioFiscal ?? {};
    console.log('✅ Consulta OK');
    console.log(`   Nombre:    ${dg.razonSocial ?? [dg.apellido, dg.nombre].filter(Boolean).join(' ')}`);
    console.log(`   Estado:    ${dg.estadoClave}`);
    console.log(`   Domicilio: ${[dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', ')}`);
    if (persona.errorConstancia) console.log('   Observaciones:', JSON.stringify(persona.errorConstancia));
  } catch (e) {
    console.log('❌ Falló:', e.message);
    if (e.data) console.log('   DETALLE:', typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
  }
})();
