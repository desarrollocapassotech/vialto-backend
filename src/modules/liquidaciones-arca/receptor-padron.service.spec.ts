/**
 * Pruebas del chequeo de CUIT del receptor contra el padrón antes de emitir (cliente AFIP mockeado).
 * Ejecutar: npm run test:receptor-padron
 */
import * as assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { PadronService } from '../../core/padron/padron.service';
import { ReceptorPadronService } from './receptor-padron.service';

const CUIT = '30716741792';
const TENANT = 'org_test';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

function serviceCon(respuesta: () => Promise<unknown>) {
  const padron = new PadronService();
  const calls = { n: 0 };
  (padron as any).afip = {
    RegisterInscriptionProof: {
      getTaxpayerDetails: () => {
        calls.n++;
        return respuesta();
      },
    },
  };
  return { service: new ReceptorPadronService(padron), padron, calls };
}

const activo = async () => ({ datosGenerales: { razonSocial: 'X SA', estadoClave: 'ACTIVO' } });
const inactivo = async () => ({ datosGenerales: { razonSocial: 'X SA', estadoClave: 'INACTIVO' } });
const receptor = { nombre: 'X SA', idFiscal: CUIT, pais: 'AR' };

(async () => {
  await test('CUIT activo → emite', async () => {
    const { service } = serviceCon(activo);
    await service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente');
  });

  await test('CUIT inactivo (apócrifo) → 422 con el CUIT en el mensaje', async () => {
    const { service } = serviceCon(inactivo);
    await assert.rejects(
      service.assertReceptorActivo(TENANT, 'produccion', receptor, 'transportista'),
      (e: unknown) =>
        e instanceof UnprocessableEntityException &&
        String((e.getResponse() as { message: string }).message).includes(CUIT),
    );
  });

  await test('CUIT inexistente → 422', async () => {
    const { service } = serviceCon(async () => null);
    await assert.rejects(
      service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente'),
      UnprocessableEntityException,
    );
  });

  await test('homologación, sin CUIT o país extranjero → no consulta', async () => {
    const { service, calls } = serviceCon(inactivo);
    await service.assertReceptorActivo(TENANT, 'homologacion', receptor, 'cliente');
    await service.assertReceptorActivo(TENANT, 'produccion', { idFiscal: null, pais: 'AR' }, 'cliente');
    await service.assertReceptorActivo(TENANT, 'produccion', { idFiscal: CUIT, pais: 'UY' }, 'cliente');
    assert.equal(calls.n, 0);
  });

  await test('ARCA caído → no bloquea la emisión', async () => {
    const { service } = serviceCon(async () => {
      throw new Error('ECONNRESET');
    });
    await service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente');
  });

  await test('caché de más de 24 h → vuelve a consultar (puede haber pasado a apócrifo)', async () => {
    const { service, padron, calls } = serviceCon(activo);
    await service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente');
    await service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente');
    assert.equal(calls.n, 1);
    (padron as any).cache.get(CUIT).fetchedAt -= 25 * 60 * 60 * 1000;
    await service.assertReceptorActivo(TENANT, 'produccion', receptor, 'cliente');
    assert.equal(calls.n, 2);
  });

  console.log('\nTodas las pruebas del chequeo de receptor pasaron.');
})().catch(() => process.exit(1));
