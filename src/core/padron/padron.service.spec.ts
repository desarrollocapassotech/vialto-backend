/**
 * Pruebas del mapeo del padrón ARCA y validación de CUIT (sin red: cliente AFIP mockeado).
 * Ejecutar: npm run test:padron
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PadronService } from './padron.service';
import { cuitDigitoVerificadorValido } from '../../shared/util/cuit';

const CUIT_NYM = '30716741792';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

/** Service con el cliente AFIP reemplazado; `calls` cuenta las consultas reales. */
function serviceCon(respuesta: () => Promise<unknown>) {
  const service = new PadronService();
  const calls = { n: 0 };
  (service as any).afip = {
    RegisterInscriptionProof: {
      getTaxpayerDetails: () => {
        calls.n++;
        return respuesta();
      },
    },
  };
  return { service, calls };
}

(async () => {
  await test('dígito verificador: acepta CUITs reales con o sin guiones', () => {
    assert.equal(cuitDigitoVerificadorValido(CUIT_NYM), true);
    assert.equal(cuitDigitoVerificadorValido('30-71674179-2'), true);
    assert.equal(cuitDigitoVerificadorValido('20384421998'), true);
  });

  await test('dígito verificador: rechaza DV incorrecto o largo inválido', () => {
    assert.equal(cuitDigitoVerificadorValido('30716741793'), false);
    assert.equal(cuitDigitoVerificadorValido('3071674179'), false);
  });

  await test('persona jurídica activa → nombre, domicilio y RI', async () => {
    const { service } = serviceCon(async () => ({
      datosGenerales: {
        razonSocial: 'NYM LOGISTICA S.S.',
        estadoClave: 'ACTIVO',
        domicilioFiscal: {
          direccion: 'CALLE 40 BIS 2920',
          localidad: 'COLONIA CAROYA',
          descripcionProvincia: 'CORDOBA',
        },
      },
      datosRegimenGeneral: { impuesto: [{ idImpuesto: 30 }, { idImpuesto: 10 }] },
    }));
    assert.deepEqual(await service.consultar('30-71674179-2', 't1'), {
      cuit: CUIT_NYM,
      estado: 'activo',
      nombre: 'NYM LOGISTICA S.S.',
      domicilio: 'CALLE 40 BIS 2920, COLONIA CAROYA, CORDOBA',
      condicionIva: 1,
      observaciones: [],
    });
  });

  await test('entidades HTML de ARCA → se decodifican (PE&#209;A → PEÑA)', async () => {
    const { service } = serviceCon(async () => ({
      datosGenerales: {
        apellido: 'PE&#209;A',
        nombre: 'JOS&#xC9;',
        estadoClave: 'ACTIVO',
        domicilioFiscal: {
          direccion: 'CASTULO PE&#209;A 35',
          localidad: 'JESUS MARIA',
          descripcionProvincia: 'CORDOBA',
        },
      },
    }));
    const r = await service.consultar(CUIT_NYM, 't1');
    assert.equal(r.nombre, 'PEÑA JOSÉ');
    assert.equal(r.domicilio, 'CASTULO PEÑA 35, JESUS MARIA, CORDOBA');
  });

  await test('persona humana monotributista inactiva → apellido + nombre, monotributo', async () => {
    const { service } = serviceCon(async () => ({
      datosGenerales: { apellido: 'PEREZ', nombre: 'JUAN', estadoClave: 'INACTIVO' },
      datosMonotributo: { impuesto: { idImpuesto: 20 } },
    }));
    const r = await service.consultar(CUIT_NYM, 't1');
    assert.equal(r.estado, 'inactivo');
    assert.equal(r.nombre, 'PEREZ JUAN');
    assert.equal(r.domicilio, null);
    assert.equal(r.condicionIva, 6);
  });

  await test('sin constancia emitible → con_observaciones, nombre desde errorConstancia', async () => {
    const { service } = serviceCon(async () => ({
      errorConstancia: { apellido: 'EMPRESA SA', error: 'La CUIT no posee impuestos activos' },
    }));
    const r = await service.consultar(CUIT_NYM, 't1');
    assert.equal(r.estado, 'con_observaciones');
    assert.equal(r.nombre, 'EMPRESA SA');
    assert.deepEqual(r.observaciones, ['La CUIT no posee impuestos activos']);
  });

  await test('CUIT inexistente → no_encontrado', async () => {
    const { service } = serviceCon(async () => null);
    assert.equal((await service.consultar(CUIT_NYM, 't1')).estado, 'no_encontrado');
  });

  await test('DV inválido → 400 sin consultar ARCA', async () => {
    const { service, calls } = serviceCon(async () => null);
    await assert.rejects(service.consultar('30716741793', 't1'), BadRequestException);
    assert.equal(calls.n, 0);
  });

  await test('caché: la segunda consulta del mismo CUIT no vuelve a ARCA', async () => {
    const { service, calls } = serviceCon(async () => null);
    await service.consultar(CUIT_NYM, 't1');
    await service.consultar(CUIT_NYM, 't2');
    assert.equal(calls.n, 1);
  });

  await test('error de ARCA → 503 amigable y no se cachea', async () => {
    const { service, calls } = serviceCon(async () => {
      throw new Error('ECONNRESET');
    });
    await assert.rejects(service.consultar(CUIT_NYM, 't1'), ServiceUnavailableException);
    await assert.rejects(service.consultar(CUIT_NYM, 't1'), ServiceUnavailableException);
    assert.equal(calls.n, 2);
  });

  await test('tope diario por tenant → 429', async () => {
    const { service } = serviceCon(async () => null);
    (service as any).consultasPorTenant.set('t1', {
      dia: new Date().toISOString().slice(0, 10),
      cantidad: 100,
    });
    await assert.rejects(service.consultar(CUIT_NYM, 't1'), (e: any) => e.getStatus() === 429);
  });
})().catch(() => process.exit(1));
