/**
 * Setup único del certificado de plataforma para consultar el padrón de ARCA
 * (ws_sr_constancia_inscripcion) — validación de CUIT en alta/edición de
 * clientes y transportistas, para todos los tenants.
 *
 * Usa las automatizaciones de afipsdk.com, con la cuenta de afipsdk dedicada
 * al padrón (PADRON_AFIP_SDK_API_KEY), separada de la de facturación de NyM:
 *   1. add-relation          → habilita "Administración de Certificados Digitales" (si ya está, sigue)
 *   2. create-cert-prod      → crea certificado + clave privada de producción
 *   3. auth-web-service-prod → autoriza el certificado para ws_sr_constancia_inscripcion
 *   4. prueba real           → consulta el padrón con tu propio CUIT
 *
 * Uso (desde vialto-backend):  node scripts/setup-padron-cert.js
 * Pide CUIT y clave fiscal por consola (la clave no se muestra ni se guarda).
 * Deja cert/key en scripts/.padron-cert/ (gitignoreado) para cargarlos en Render.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Afip = require('@afipsdk/afip.js');

const ALIAS = 'vialtopadron';
const SERVICE = 'ws_sr_constancia_inscripcion';
const OUT_DIR = path.resolve(__dirname, '.padron-cert');

const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const val = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : null;
};

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const detail = (e) =>
  e?.data ? (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : e?.message ?? String(e);

(async () => {
  const accessToken = val('PADRON_AFIP_SDK_API_KEY');
  if (!accessToken) {
    console.log('❌ Falta PADRON_AFIP_SDK_API_KEY en vialto-backend/.env (token de la cuenta de afipsdk del padrón).');
    process.exit(1);
  }

  const cuit = (await ask('CUIT (sin guiones): ')).replace(/\D/g, '');
  if (cuit.length !== 11) {
    console.log('❌ El CUIT debe tener 11 dígitos.');
    process.exit(1);
  }
  const password = await ask('Clave fiscal: ', { hidden: true });

  const afip = new Afip({ access_token: accessToken });
  const base = { cuit, username: cuit, password };

  // 1. Habilitar Administración de Certificados Digitales (puede ya estar habilitado)
  try {
    console.log('\n[1/4] Habilitando Administración de Certificados Digitales...');
    await afip.CreateAutomation(
      'add-relation',
      { ...base, service: 'web://arfe_certificado', delegate_to: cuit },
      true,
    );
    console.log('      ✅ OK');
  } catch (e) {
    console.log('      ⚠️  No se pudo (probablemente ya estaba habilitado), sigo:', detail(e));
  }

  // 2. Crear certificado de producción
  let cert;
  let key;
  try {
    console.log(`[2/4] Creando certificado de producción (alias "${ALIAS}")...`);
    const res = await afip.CreateAutomation('create-cert-prod', { ...base, alias: ALIAS }, true);
    cert = res?.data?.cert;
    key = res?.data?.key;
    if (!cert || !key) throw new Error(`Respuesta sin cert/key: ${JSON.stringify(res)}`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `${ALIAS}.crt`), cert);
    fs.writeFileSync(path.join(OUT_DIR, `${ALIAS}.key`), key);
    console.log(`      ✅ OK → guardados en ${OUT_DIR}`);
  } catch (e) {
    console.log('      ❌ Falló:', detail(e));
    console.log('      → Si dice que el alias ya existe, cambiá ALIAS en este script y volvé a correrlo.');
    process.exit(1);
  }

  // 3. Autorizar el certificado para el padrón
  try {
    console.log(`[3/4] Autorizando ${SERVICE}...`);
    await afip.CreateAutomation('auth-web-service-prod', { ...base, alias: ALIAS, service: SERVICE }, true);
    console.log('      ✅ OK');
  } catch (e) {
    console.log('      ❌ Falló:', detail(e));
    console.log('      → El certificado ya quedó guardado; podés reintentar solo este paso.');
    process.exit(1);
  }

  // 4. Prueba real contra el padrón
  try {
    console.log('[4/4] Consultando el padrón con tu CUIT...');
    const client = new Afip({ CUIT: Number(cuit), access_token: accessToken, production: true, cert, key });
    const persona = await client.RegisterInscriptionProof.getTaxpayerDetails(Number(cuit));
    const dg = persona?.datosGenerales ?? {};
    const nombre = dg.razonSocial ?? [dg.apellido, dg.nombre].filter(Boolean).join(' ');
    const dom = dg.domicilioFiscal ?? {};
    console.log('      ✅ OK');
    console.log(`         Nombre:    ${nombre || '(vacío)'}`);
    console.log(`         Estado:    ${dg.estadoClave ?? '(vacío)'}`);
    console.log(`         Domicilio: ${[dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', ') || '(vacío)'}`);
  } catch (e) {
    console.log('      ❌ Falló la consulta:', detail(e));
    console.log('      → A veces ARCA tarda unos minutos en propagar la autorización. Reintentá más tarde.');
  }

  console.log('\nListo. Cargá en Render (QA y producción) y en tu .env:');
  console.log('  PADRON_AFIP_SDK_API_KEY=<token de la cuenta de afipsdk del padrón>');
  console.log(`  PADRON_CUIT=${cuit}`);
  console.log(`  PADRON_CERT=<contenido de ${ALIAS}.crt>`);
  console.log(`  PADRON_KEY=<contenido de ${ALIAS}.key>`);
  console.log('Después guardá la carpeta .padron-cert en un lugar seguro y borrala del proyecto.');
})();
