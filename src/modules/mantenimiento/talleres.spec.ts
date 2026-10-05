/**
 * Pruebas de talleres (MANT-02-T3), con Prisma mockeado en memoria.
 * Ejecutar: npm run test:mant-talleres
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
function crearPrisma(talleresIniciales: Row[] = [], ordenes: Row[] = [], opts: { p2002?: boolean } = {}) {
  const talleres = [...talleresIniciales];
  let n = 0;
  const conCount = (t: Row) => ({ ...t, _count: { ordenes: ordenes.filter((o) => o.tallerId === t.id).length } });
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
  const client: Row = {
    taller: {
      findMany: async ({ where }: Row) => talleres.filter((t) => coincide(t, where)).map(conCount),
      findFirst: async ({ where }: Row) => {
        const t = talleres.find((x) => coincide(x, where));
        return t ? conCount(t) : null;
      },
      create: async ({ data }: Row) => {
        if (opts.p2002) throw p2002();
        const t = { id: `t${++n}`, interno: false, ...data };
        talleres.push(t);
        return conCount(t);
      },
      updateMany: async ({ where, data }: Row) => {
        if (opts.p2002) throw p2002();
        const hits = talleres.filter((t) => coincide(t, where));
        hits.forEach((t) => Object.assign(t, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: Row) => {
        const antes = talleres.length;
        for (let i = talleres.length - 1; i >= 0; i--) if (coincide(talleres[i], where)) talleres.splice(i, 1);
        return { count: antes - talleres.length };
      },
    },
    ordenTrabajo: { count: async ({ where }: Row) => ordenes.filter((o) => coincide(o, where)).length },
  };
  return { svc: new TalleresService(client as unknown as PrismaService), talleres };
}

const taller = (o: Row = {}) => ({ id: 'tx', tenantId: T, nombre: 'Taller Norte', cuit: null, telefono: null, interno: false, activo: true, ...o });

(async () => {
  await test('CUIT: normaliza a dígitos y valida el verificador', () => {
    assert.equal(parseCuitTaller('20-12345678-6'), '20123456786');
    assert.throws(() => parseCuitTaller('20-12345678-5'), BadRequestException);
    assert.throws(() => parseCuitTaller('123'), BadRequestException);
    assert.equal(parseCuitTaller(''), null);
    assert.equal(parseCuitTaller(null), null);
    assert.equal(parseCuitTaller(undefined), undefined);
  });

  await test('alta: trim, CUIT normalizado, teléfono vacío → null, activo por defecto', async () => {
    const { svc } = crearPrisma();
    const t = await svc.create(T, { nombre: '  Diesel Sur ', cuit: '20-12345678-6', telefono: '  ' });
    assert.deepEqual([t.nombre, t.cuit, t.telefono, t.activo, t._count.ordenes], ['Diesel Sur', '20123456786', null, true, 0]);
  });

  await test('alta con CUIT inválido → 400 y no crea', async () => {
    const { svc, talleres } = crearPrisma();
    await assert.rejects(svc.create(T, { nombre: 'X', cuit: '20-12345678-5' }), BadRequestException);
    assert.equal(talleres.length, 0);
  });

  await test('nombre repetido con otro casing → 409; mismo nombre en otro tenant → OK', async () => {
    const { svc } = crearPrisma([taller(), taller({ id: 'tB', tenantId: 'org_B', nombre: 'Otro' })]);
    await assert.rejects(svc.create(T, { nombre: 'taller NORTE' }), ConflictException);
    await svc.create(T, { nombre: 'Otro' });
  });

  await test('P2002 de la DB (alta simultánea) → 409', async () => {
    const { svc } = crearPrisma([], [], { p2002: true });
    await assert.rejects(svc.create(T, { nombre: 'Nuevo' }), ConflictException);
  });

  await test('editar: renombrar a uno ocupado → 409; cambiar casing del propio → OK; null borra el CUIT', async () => {
    const { svc } = crearPrisma([taller({ cuit: '20123456786' }), taller({ id: 'ty', nombre: 'Lubricentro' })]);
    await assert.rejects(svc.update(T, 'ty', { nombre: 'TALLER NORTE' }), ConflictException);
    const t = await svc.update(T, 'tx', { nombre: 'TALLER NORTE', cuit: null, activo: false });
    assert.deepEqual([t.nombre, t.cuit, t.activo], ['TALLER NORTE', null, false]);
  });

  await test('editar sin tocar el CUIT lo conserva', async () => {
    const { svc } = crearPrisma([taller({ cuit: '20123456786' })]);
    const t = await svc.update(T, 'tx', { telefono: '341 555' });
    assert.deepEqual([t.cuit, t.telefono], ['20123456786', '341 555']);
  });

  await test('taller de otro tenant → 404 en get/update/delete', async () => {
    const { svc, talleres } = crearPrisma([taller({ tenantId: 'org_B' })]);
    await assert.rejects(svc.findOne(T, 'tx'), NotFoundException);
    await assert.rejects(svc.update(T, 'tx', { activo: false }), NotFoundException);
    await assert.rejects(svc.remove(T, 'tx'), NotFoundException);
    assert.equal(talleres[0].activo, true);
  });

  await test('borrar: con OT → 409; sin OT → borra', async () => {
    const { svc, talleres } = crearPrisma([taller(), taller({ id: 'ty', nombre: 'Otro' })], [{ tenantId: T, tallerId: 'tx' }]);
    await assert.rejects(svc.remove(T, 'tx'), ConflictException);
    await svc.remove(T, 'ty');
    assert.deepEqual(talleres.map((t) => t.id), ['tx']);
  });

  await test('listado filtra por tenant y por activo', async () => {
    const { svc } = crearPrisma([taller(), taller({ id: 'ty', nombre: 'B', activo: false }), taller({ id: 'tB', tenantId: 'org_B' })]);
    assert.equal((await svc.findAll(T, {})).length, 2);
    assert.equal((await svc.findAll(T, { activo: 'false' })).length, 1);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
