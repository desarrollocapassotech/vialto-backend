/**
 * Pruebas del service que registra el chofer desde la app de Combustible (Prisma y OrdenesService mockeados).
 * Ejecutar: npm run test:mant-chofer
 */
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChoferMantenimientoService } from './chofer-mantenimiento.service';
import type { PrismaService } from '../../../shared/prisma/prisma.service';
import type { OdometroService } from '../../../core/odometro/odometro.service';
import type { OrdenesService } from '../ordenes.service';
import type { TalleresService } from '../talleres.service';

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
const T = 'org_A';
const CHOFER = 'ch1';

function crear(opts: { modules?: string[]; conPlanes?: boolean; asignado?: boolean } = {}) {
  const { modules = ['combustible', 'mantenimiento'], conPlanes = true, asignado = true } = opts;
  const consultas: Row[] = [];
  const creadas: Row[] = [];
  const ordenesWhere: Row[] = [];
  const prisma = {
    tenant: {
      findUnique: async ({ where }: Row) => (where.clerkOrgId === T ? { modules, mantenimientoPlanesHabilitados: conPlanes } : null),
    },
    asignacionVehiculo: {
      findFirst: async ({ where }: Row) => {
        consultas.push({ modelo: 'asignacion', where });
        return asignado && where.tenantId === T && where.choferId === CHOFER && where.fechaHasta === null
          ? { vehiculo: { id: 'v1', patente: 'AA123BB' } }
          : null;
      },
    },
    vehiculoPlan: {
      findMany: async ({ where }: Row) => {
        consultas.push({ modelo: 'vehiculoPlan', where });
        return where.tenantId === T && where.vehiculoId === 'v1'
          ? [
              { id: 'vp1', plan: { nombre: 'Service motor', tareas: ['cambio_aceite_motor', 'revision_filtros'] } },
              { id: 'vp2', plan: { nombre: 'Engrase', tareas: ['engrasado_chasis', 'revision_filtros'] } },
            ]
          : [];
      },
    },
    ordenTrabajo: {
      findMany: async ({ where }: Row) => {
        ordenesWhere.push(where);
        return [
          {
            id: 'o1', numero: 3, fecha: new Date('2026-10-20'), km: 480_000, estado: 'cerrada',
            tareas: ['cambio_aceite_motor', 'tarea_desconocida'], descripcion: null, adjuntos: [],
            vehiculo: { patente: 'AA123BB' }, taller: { nombre: 'Lubricentro Norte' },
            planes: [{ vehiculoPlan: { plan: { nombre: 'Service motor' } } }],
          },
        ];
      },
    },
    taller: {
      findMany: async ({ where }: Row) => talleres.filter((t) => t.tenantId === where.tenantId && t.activo),
      findFirst: async ({ where }: Row) =>
        talleres.find((t) => t.tenantId === where.tenantId && t.nombre.toLowerCase() === where.nombre.equals.toLowerCase()) ?? null,
    },
  } as unknown as PrismaService;
  const talleres: Row[] = [
    { id: 't1', tenantId: T, nombre: 'Lubricentro Norte', activo: true },
    { id: 'tB', tenantId: 'org_B', nombre: 'Taller de otra empresa', activo: true },
  ];
  const talleresSvc = {
    create: async (tenantId: string, dto: Row) => {
      const t = { id: `t${talleres.length + 1}`, tenantId, nombre: dto.nombre, activo: true };
      talleres.push(t);
      return t;
    },
  } as unknown as TalleresService;
  const odometro = { getUltimaLectura: async () => ({ km: 480_000 }) } as unknown as OdometroService;
  const ordenes = {
    create: async (tenantId: string, userId: string, dto: Row, origen?: string) => {
      creadas.push({ tenantId, userId, dto, origen });
      return { id: 'o1', numero: 7, warning: null };
    },
    subirAdjunto: async (tenantId: string) => ({ url: `https://res.cloudinary.com/x/${tenantId}/foto.jpg` }),
  } as unknown as OrdenesService;
  return { svc: new ChoferMantenimientoService(prisma, odometro, ordenes, talleresSvc), consultas, creadas, talleres, ordenesWhere };
}

(async () => {
  await test('contexto: sin el módulo → no habilitado y no consulta el vehículo', async () => {
    const { svc, consultas } = crear({ modules: ['combustible'] });
    assert.deepEqual(await svc.contexto(T, CHOFER), {
      habilitado: false, vehiculo: null, kmActual: null, planes: [], talleres: [], tareas: [],
    });
    assert.equal(consultas.length, 0);
  });

  await test('contexto: con vehículo asignado → patente, km y planes', async () => {
    const { svc } = crear();
    const c = await svc.contexto(T, CHOFER);
    assert.deepEqual(c.vehiculo, { id: 'v1', patente: 'AA123BB' });
    assert.equal(c.kmActual, 480_000);
    assert.deepEqual(c.planes.map((p) => p.nombre), ['Service motor', 'Engrase']);
    assert.deepEqual(c.planes[0].tareas, ['cambio_aceite_motor', 'revision_filtros']);
    assert.deepEqual(c.talleres.map((t) => t.nombre), ['Lubricentro Norte'], 'solo los de la empresa');
    assert.ok(c.tareas.length > 0 && c.tareas.every((g) => g.tareas.length > 0));
  });

  await test('contexto: planes apagados por superadmin → sin planes', async () => {
    const { svc } = crear({ conPlanes: false });
    assert.deepEqual((await svc.contexto(T, CHOFER)).planes, []);
  });

  await test('contexto: sin vehículo asignado → habilitado pero sin vehículo', async () => {
    const { svc } = crear({ asignado: false });
    assert.deepEqual(await svc.contexto(T, CHOFER), {
      habilitado: true, vehiculo: null, kmActual: null, planes: [], talleres: [], tareas: [],
    });
  });

  await test('registrar: sin módulo → 403; sin vehículo → 400; sin plan ni comentario → 400', async () => {
    await assert.rejects(crear({ modules: ['combustible'] }).svc.registrar(T, CHOFER, { fecha: '2026-10-23' }), ForbiddenException);
    await assert.rejects(crear({ asignado: false }).svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x' }), BadRequestException);
    await assert.rejects(crear().svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: '' }), BadRequestException);
  });

  await test('registrar: OT del vehículo asignado, tareas de los planes tildados, origen reporte_chofer', async () => {
    const { svc, creadas, consultas } = crear();
    const r = await svc.registrar(T, CHOFER, { fecha: '2026-10-23', km: 481_000, vehiculoPlanIds: ['vp1', 'vp2'] });
    assert.deepEqual(r, { id: 'o1', numero: 7, patente: 'AA123BB', warning: null });
    const [c] = creadas;
    assert.equal(c.tenantId, T);
    assert.equal(c.userId, 'chofer:ch1');
    assert.equal(c.origen, 'reporte_chofer');
    assert.equal(c.dto.vehiculoId, 'v1');
    assert.equal(c.dto.tipo, 'preventivo');
    assert.deepEqual(c.dto.tareas, ['cambio_aceite_motor', 'revision_filtros', 'engrasado_chasis']);
    assert.ok(consultas.every((q) => q.where.tenantId === T));
  });

  await test('registrar: con planes apagados ignora los planes y alcanza el comentario', async () => {
    const { svc, creadas } = crear({ conPlanes: false });
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', vehiculoPlanIds: ['vp1'], descripcion: 'Cambio de aceite' });
    assert.deepEqual([creadas[0].dto.vehiculoPlanIds, creadas[0].dto.tareas, creadas[0].dto.descripcion], [[], [], 'Cambio de aceite']);
    await assert.rejects(svc.registrar(T, CHOFER, { fecha: '2026-10-23', vehiculoPlanIds: ['vp1'] }), BadRequestException);
  });

  await test('registrar: tareas elegidas + las de los planes, sin repetir; alcanzan solas', async () => {
    const { svc, creadas } = crear();
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', tareas: ['cambio_cubiertas', 'revision_filtros'], vehiculoPlanIds: ['vp1'] });
    assert.deepEqual(creadas[0].dto.tareas, ['cambio_cubiertas', 'revision_filtros', 'cambio_aceite_motor']);
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', tareas: ['prueba_baterias'] });
    assert.deepEqual(creadas[1].dto.tareas, ['prueba_baterias']);
  });

  await test('registrar: taller de la lista, escrito con otro casing (reusa) o nuevo (lo crea)', async () => {
    const { svc, creadas, talleres } = crear();
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x', tallerId: 't1' });
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x', tallerNombre: 'lubricentro norte' });
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x', tallerNombre: 'Gomería Ruta 9' });
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x' });
    assert.deepEqual(creadas.map((c) => c.dto.tallerId), ['t1', 't1', 't3', null]);
    assert.equal(talleres.find((t) => t.id === 't3')?.tenantId, T);
  });

  await test('mis services: solo los del chofer y su empresa, con tareas traducidas; sin módulo → vacío', async () => {
    const { svc, ordenesWhere } = crear();
    const r = await svc.misServices(T, CHOFER);
    assert.deepEqual(ordenesWhere[0], { tenantId: T, createdBy: 'chofer:ch1' });
    assert.deepEqual(r[0].tareas, ['Cambio de aceite de motor', 'tarea_desconocida']);
    assert.deepEqual([r[0].patente, r[0].taller, r[0].planes], ['AA123BB', 'Lubricentro Norte', ['Service motor']]);
    assert.deepEqual(await crear({ modules: ['combustible'] }).svc.misServices(T, CHOFER), []);
  });

  await test('fotos: solo imágenes y solo con el módulo; se mandan a la OT', async () => {
    const img = { mimetype: 'image/jpeg', buffer: Buffer.from(''), originalname: 'f.jpg' } as Express.Multer.File;
    const pdf = { ...img, mimetype: 'application/pdf' } as Express.Multer.File;
    const { svc, creadas } = crear();
    assert.deepEqual(await svc.subirFoto(T, img), { url: `https://res.cloudinary.com/x/${T}/foto.jpg` });
    await assert.rejects(svc.subirFoto(T, pdf), BadRequestException);
    await assert.rejects(svc.subirFoto(T, undefined), BadRequestException);
    await assert.rejects(crear({ modules: ['combustible'] }).svc.subirFoto(T, img), ForbiddenException);
    await svc.registrar(T, CHOFER, { fecha: '2026-10-23', descripcion: 'x', adjuntos: ['https://res.cloudinary.com/a.jpg'] });
    assert.deepEqual(creadas[0].dto.adjuntos, ['https://res.cloudinary.com/a.jpg']);
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
