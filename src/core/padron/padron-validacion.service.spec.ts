/**
 * Pruebas de la validación de clientes/transportistas guardados contra el padrón
 * (marca/huella, actualización automática, opt-in). Prisma y PadronService mockeados, sin red.
 * Ejecutar: npm run test:padron-validacion
 */
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { PadronValidacionService, huellaFiscal } from './padron-validacion.service';
import { PadronConsulta } from './padron.types';

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

const padronActivo: PadronConsulta = {
  cuit: CUIT,
  estado: 'activo',
  nombre: 'NYM LOGISTICA SAS',
  domicilio: 'LEONARDO CANCIANI 56, COLONIA CAROYA, CORDOBA',
  condicionIva: 1,
  observaciones: [],
};

type Row = {
  nombre: string;
  idFiscal: string | null;
  pais: string | null;
  condicionIva: number | null;
  domicilio: string | null;
  arcaValidadoHuella: string | null;
  arcaValidadoAt: Date | null;
};

/** Service con un transportista en memoria; `consultas` cuenta las idas al padrón. */
function setup(row: Row, opts: { habilitada?: boolean; padron?: PadronConsulta } = {}) {
  const consultas = { n: 0 };
  const updates: unknown[] = [];
  const prisma = {
    tenant: {
      findUnique: async () => ({ validacionCuitArcaHabilitada: opts.habilitada ?? true }),
    },
    transportista: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.tenantId === TENANT && where.id === 't1' ? { ...row } : null,
      updateMany: async (args: { data: Partial<Row> }) => {
        updates.push(args.data);
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
  };
  const padron = {
    consultar: async () => {
      consultas.n++;
      return opts.padron ?? padronActivo;
    },
  };
  const service = new PadronValidacionService(prisma as any, padron as any);
  return { service, consultas, updates, row };
}

const base: Row = {
  nombre: 'NYM LOGISTICA SAS',
  idFiscal: '30-71674179-2',
  pais: 'AR',
  condicionIva: 1,
  domicilio: 'Leonardo Canciani 56, Colonia Caroya, Córdoba',
  arcaValidadoHuella: null,
  arcaValidadoAt: null,
};

(async () => {
  await test('datos que coinciden con ARCA (domicilio escrito distinto) → valida y deja la marca', async () => {
    const { service, consultas, updates } = setup({ ...base });
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal(r.resultado, 'validado');
    assert.equal(consultas.n, 1);
    assert.equal(updates.length, 1);
  });

  await test('ya validado con los mismos datos → no vuelve a consultar ARCA', async () => {
    const { service, consultas } = setup({
      ...base,
      arcaValidadoHuella: huellaFiscal(base),
      arcaValidadoAt: new Date(),
    });
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.deepEqual([r.resultado, (r as any).desdeMarca], ['validado', true]);
    assert.equal(consultas.n, 0);
  });

  await test('cambió la condición IVA después de validar → reconsulta y pisa con la de ARCA', async () => {
    const { service, consultas, row } = setup({
      ...base,
      condicionIva: 6,
      arcaValidadoHuella: huellaFiscal(base),
      arcaValidadoAt: new Date(),
    });
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal(consultas.n, 1);
    assert.equal(r.resultado, 'actualizado');
    assert.deepEqual((r as any).cambios, ['condicionIva']);
    assert.equal(row.condicionIva, 1);
  });

  await test('razón social y domicilio distintos → se actualizan solos, el CUIT no se toca, queda la marca', async () => {
    const { service, row, updates } = setup({ ...base, nombre: 'NyM', domicilio: null });
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal(r.resultado, 'actualizado');
    assert.deepEqual((r as any).cambios, ['nombre', 'domicilio']);
    assert.equal(updates.length, 1);
    assert.equal(row.nombre, padronActivo.nombre);
    assert.equal(row.domicilio, padronActivo.domicilio);
    assert.equal(row.idFiscal, base.idFiscal);
    assert.equal(row.arcaValidadoHuella, huellaFiscal(row));
    // y la próxima validación sale de la marca, sin consultar
    const r2 = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal((r2 as any).desdeMarca, true);
  });

  await test('CUIT inactivo en ARCA → rechazado', async () => {
    const { service } = setup({ ...base }, { padron: { ...padronActivo, estado: 'inactivo' } });
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal(r.resultado, 'rechazado');
  });

  await test('CUIT inactivo en ARCA con marca previa → rechazado y limpia la marca', async () => {
    const { service, updates, row } = setup(
      { ...base, arcaValidadoHuella: 'vieja-huella', arcaValidadoAt: new Date() },
      { padron: { ...padronActivo, estado: 'inactivo' } },
    );
    const r = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal(r.resultado, 'rechazado');
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], { arcaValidadoHuella: null, arcaValidadoAt: null });
    assert.equal(row.arcaValidadoHuella, null);
    assert.equal(row.arcaValidadoAt, null);
  });

  await test('sin CUIT o país extranjero → no_aplica, sin consultar', async () => {
    const a = setup({ ...base, idFiscal: null });
    assert.equal((await a.service.validar(TENANT, 'transportistas', 't1')).resultado, 'no_aplica');
    const b = setup({ ...base, pais: 'UY' });
    assert.equal((await b.service.validar(TENANT, 'transportistas', 't1')).resultado, 'no_aplica');
    assert.equal(a.consultas.n + b.consultas.n, 0);
  });

  await test('confirmar → respeta la edición manual: la próxima validación no la pisa', async () => {
    const { service, row, consultas } = setup({ ...base, domicilio: 'Canciani 56 - Caroya' });
    const r = await service.confirmar(TENANT, 'transportistas', 't1');
    assert.equal(r.resultado, 'validado');
    assert.equal(row.domicilio, 'Canciani 56 - Caroya');
    assert.equal(row.arcaValidadoHuella, huellaFiscal(row));
    const r2 = await service.validar(TENANT, 'transportistas', 't1');
    assert.equal((r2 as any).desdeMarca, true);
    assert.equal(consultas.n, 1);
  });

  await test('empresa sin la validación habilitada → 403', async () => {
    const { service } = setup({ ...base }, { habilitada: false });
    await assert.rejects(service.validar(TENANT, 'transportistas', 't1'), ForbiddenException);
  });

  await test('transportista de otra empresa → no encontrado', async () => {
    const { service } = setup({ ...base });
    await assert.rejects(service.validar('org_otra', 'transportistas', 't1'));
  });

  console.log('\nTodas las pruebas de validación contra el padrón pasaron.');
})().catch(() => process.exit(1));
