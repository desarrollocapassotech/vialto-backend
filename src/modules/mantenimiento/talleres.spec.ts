/**
 * Pruebas de talleres (MANT-02-T3), con Prisma mockeado en memoria. Desde nov 2026 un
 * taller es un proveedor (tabla `transportistas`) de tipo "taller".
 * Ejecutar: npm run test:mant-talleres
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TalleresService, parseCuitTaller } from './talleres.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

let fallos = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

type Row = Record<string, any>;
function coincide(r: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object') {
      if ('equals' in v) return String(r[k]).toLowerCase() === String(v.equals).toLowerCase();
      if ('not' in v) return r[k] !== v.not;
    }
    return r[k] === v;
  });
}

const T = 'org_A';
function crearPrisma(proveedoresIniciales: Row[] = [], ordenes: Row[] = [], movimientos: Row[] = []) {
  const proveedores = [...proveedoresIniciales];
  let n = 0;
  const conCount = (t: Row) => ({
    ...t,
    _count: { ordenesTrabajo: ordenes.filter((o) => o.tallerId === t.id).length },
  });
  const client: Row = {
    transportista: {
      findMany: async ({ where }: Row) => proveedores.filter((t) => coincide(t, where)).map(conCount),
      findFirst: async ({ where }: Row) => {
        const t = proveedores.find((x) => coincide(x, where));
        return t ? conCount(t) : null;
      },
      create: async ({ data }: Row) => {
        const t = { id: `t${++n}`, ...data };
        proveedores.push(t);
        return conCount(t);
      },
      updateMany: async ({ where, data }: Row) => {
        const hits = proveedores.filter((t) => coincide(t, where));
        hits.forEach((t) => Object.assign(t, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: Row) => {
        const antes = proveedores.length;
        for (let i = proveedores.length - 1; i >= 0; i--) if (coincide(proveedores[i], where)) proveedores.splice(i, 1);
        return { count: antes - proveedores.length };
      },
    },
    ordenTrabajo: { count: async ({ where }: Row) => ordenes.filter((o) => coincide(o, where)).length },
    movimientoCuentaCorriente: {
      count: async ({ where }: Row) => movimientos.filter((m) => coincide(m, where)).length,
    },
  };
  return { svc: new TalleresService(client as unknown as PrismaService), proveedores };
}

const taller = (o: Row = {}) => ({
  id: 'tx', tenantId: T, tipo: 'taller', nombre: 'Taller Norte', idFiscal: null, telefono: null, activo: true, ...o,
});

(async () => {
  await test('CUIT: normaliza a dígitos y valida el verificador', () => {
    assert.equal(parseCuitTaller('20-12345678-6'), '20123456786');
    assert.throws(() => parseCuitTaller('20-12345678-5'), BadRequestException);
    assert.throws(() => parseCuitTaller('123'), BadRequestException);
    assert.equal(parseCuitTaller(''), null);
    assert.equal(parseCuitTaller(null), null);
    assert.equal(parseCuitTaller(undefined), undefined);
  });

  await test('alta: proveedor tipo taller, trim, CUIT normalizado, teléfono vacío → null, activo por defecto', async () => {
    const { svc, proveedores } = crearPrisma();
    const t = await svc.create(T, { nombre: '  Diesel Sur ', cuit: '20-12345678-6', telefono: '  ' });
    assert.deepEqual([t.nombre, t.cuit, t.telefono, t.activo, t._count.ordenes], ['Diesel Sur', '20123456786', null, true, 0]);
    assert.equal(proveedores[0].tipo, 'taller');
    assert.equal(proveedores[0].idFiscal, '20123456786');
  });

  await test('alta con CUIT inválido → 400 y no crea', async () => {
    const { svc, proveedores } = crearPrisma();
    await assert.rejects(svc.create(T, { nombre: 'X', cuit: '20-12345678-5' }), BadRequestException);
    assert.equal(proveedores.length, 0);
  });

  await test('nombre repetido con otro casing → 409; mismo nombre en otro tenant u otro tipo → OK', async () => {
    const { svc } = crearPrisma([
      taller(),
      taller({ id: 'tB', tenantId: 'org_B', nombre: 'Otro' }),
      taller({ id: 'tr', tipo: 'transportista', nombre: 'Fletes SA' }),
    ]);
    await assert.rejects(svc.create(T, { nombre: 'taller NORTE' }), ConflictException);
    await svc.create(T, { nombre: 'Otro' });
    await svc.create(T, { nombre: 'Fletes SA' });
  });

  await test('CUIT que ya tiene otro proveedor (de cualquier tipo) → 409', async () => {
    const { svc } = crearPrisma([taller({ id: 'tr', tipo: 'transportista', nombre: 'Fletes', idFiscal: '20123456786' })]);
    await assert.rejects(svc.create(T, { nombre: 'Nuevo', cuit: '20-12345678-6' }), ConflictException);
  });

  await test('editar: renombrar a uno ocupado → 409; cambiar casing del propio → OK; null borra el CUIT', async () => {
    const { svc } = crearPrisma([taller({ idFiscal: '20123456786' }), taller({ id: 'ty', nombre: 'Lubricentro' })]);
    await assert.rejects(svc.update(T, 'ty', { nombre: 'TALLER NORTE' }), ConflictException);
    const t = await svc.update(T, 'tx', { nombre: 'TALLER NORTE', cuit: null, activo: false });
    assert.deepEqual([t.nombre, t.cuit, t.activo], ['TALLER NORTE', null, false]);
  });

  await test('editar sin tocar el CUIT lo conserva', async () => {
    const { svc } = crearPrisma([taller({ idFiscal: '20123456786' })]);
    const t = await svc.update(T, 'tx', { telefono: '341 555' });
    assert.deepEqual([t.cuit, t.telefono], ['20123456786', '341 555']);
  });

  await test('taller de otro tenant, o proveedor que no es taller → 404 en get/update/delete', async () => {
    const { svc, proveedores } = crearPrisma([
      taller({ tenantId: 'org_B' }),
      taller({ id: 'tr', tipo: 'transportista' }),
    ]);
    await assert.rejects(svc.findOne(T, 'tx'), NotFoundException);
    await assert.rejects(svc.update(T, 'tx', { activo: false }), NotFoundException);
    await assert.rejects(svc.remove(T, 'tx'), NotFoundException);
    await assert.rejects(svc.findOne(T, 'tr'), NotFoundException);
    assert.equal(proveedores[0].activo, true);
  });

  await test('borrar: con OT o cuenta corriente → 409; sin historial → borra', async () => {
    const { svc, proveedores } = crearPrisma(
      [taller(), taller({ id: 'ty', nombre: 'Otro' }), taller({ id: 'tz', nombre: 'Con CC' })],
      [{ tenantId: T, tallerId: 'tx' }],
      [{ tenantId: T, proveedorId: 'tz' }],
    );
    await assert.rejects(svc.remove(T, 'tx'), ConflictException);
    await assert.rejects(svc.remove(T, 'tz'), ConflictException);
    await svc.remove(T, 'ty');
    assert.deepEqual(proveedores.map((t) => t.id), ['tx', 'tz']);
  });

  await test('listado: solo talleres, filtra por tenant y por activo', async () => {
    const { svc } = crearPrisma([
      taller(),
      taller({ id: 'ty', nombre: 'B', activo: false }),
      taller({ id: 'tB', tenantId: 'org_B' }),
      taller({ id: 'tr', tipo: 'transportista', nombre: 'Fletes' }),
    ]);
    assert.equal((await svc.findAll(T, {})).length, 2);
    assert.equal((await svc.findAll(T, { activo: 'false' })).length, 1);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
