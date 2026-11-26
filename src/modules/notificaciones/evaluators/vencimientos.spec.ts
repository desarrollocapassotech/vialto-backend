/**
 * Pruebas del aviso unificado de vencimientos y del email de notificaciones.
 * Ejecutar: npm run test:notif-vencimientos
 */
import * as assert from 'node:assert/strict';
import { VencimientosEvaluator, etiquetaVencimiento, armarAvisosVencimientos } from './vencimientos.evaluator';
import { armarEmailNotificacion, urlApp, MAX_TARJETAS } from '../notificacion-email.template';
import { fechaCalendarioAr } from '../../../shared/util/fecha-ar.util';
import { getNotificacionesCatalogoPorModulos, urlDestinoDe, NOTIFICACIONES_CATALOG } from '../notificaciones-catalog';

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
const DIA = 86_400_000;
const hoy = fechaCalendarioAr();
const dia = (n: number) => new Date(hoy.getTime() + n * DIA);

(async () => {
  await test('etiquetaVencimiento: textos naturales', () => {
    assert.equal(etiquetaVencimiento(-1), 'Venció ayer');
    assert.equal(etiquetaVencimiento(-5), 'Venció hace 5 días');
    assert.equal(etiquetaVencimiento(0), 'Vence hoy');
    assert.equal(etiquetaVencimiento(1), 'Vence mañana');
    assert.equal(etiquetaVencimiento(3), 'Vence en 3 días');
  });

  await test('catálogo: un solo tipo de vencimientos, para Facturación o Cuenta corriente', () => {
    const tipos = (mods: string[]) => getNotificacionesCatalogoPorModulos(mods).map((c) => c.tipo);
    assert.deepEqual(tipos(['facturacion']), ['vencimientos']);
    assert.deepEqual(tipos(['cuenta-corriente']), ['vencimientos']);
    assert.deepEqual(tipos(['facturacion', 'cuenta-corriente']), ['vencimientos']);
    assert.ok(!NOTIFICACIONES_CATALOG.some((c) => /facturaPorVencer|facturaVencida|cuenta-corriente\.vencimiento/.test(c.tipo)));
    const v = NOTIFICACIONES_CATALOG.find((c) => c.tipo === 'vencimientos')!;
    assert.equal(urlDestinoDe(v, ['facturacion', 'cuenta-corriente']), '/cuenta-corriente');
    assert.equal(urlDestinoDe(v, ['facturacion']), '/facturacion');
  });

  await test('armarAvisos: vencidos primero (el más viejo arriba), entidadId con sufijo', () => {
    const base = { contraparte: 'X', sentido: 'cobrar' as const, comprobante: null, saldo: 10, moneda: 'ARS', url: '/x' };
    const items = armarAvisosVencimientos(
      [
        { ...base, id: 'a', fechaVencimiento: dia(2) },
        { ...base, id: 'b', fechaVencimiento: dia(-1) },
        { ...base, id: 'c', fechaVencimiento: dia(-6) },
        { ...base, id: 'd', fechaVencimiento: dia(0) },
      ],
      hoy,
    );
    assert.deepEqual(
      items.map((i) => i.entidadId),
      ['c:vencido', 'b:vencido', 'd:por-vencer', 'a:por-vencer'],
    );
    assert.equal(items[0].tono, 'alerta');
    assert.equal(items[0].seccion, 'A cobrar a clientes');
    assert.equal(items[2].tono, 'aviso');
  });

  await test('armarAvisos: clientes primero y proveedores después, sin repetir el lado en la fila', () => {
    const base = { comprobante: 'FACTURA A 1', saldo: 10, moneda: 'ARS', url: '/x' };
    const items = armarAvisosVencimientos(
      [
        { ...base, id: 'p', contraparte: 'Prov', sentido: 'pagar', fechaVencimiento: dia(-9) },
        { ...base, id: 'c', contraparte: 'Cli', sentido: 'cobrar', fechaVencimiento: dia(2) },
      ],
      hoy,
    );
    assert.deepEqual(items.map((i) => i.seccion), ['A cobrar a clientes', 'A pagar a proveedores']);
    assert.equal(items[0].encabezado, 'Cli');
    assert.equal(items[0].subtitulo, 'FACTURA A 1');
  });

  await test('con Cuenta corriente: usa los movimientos (no las facturas) y arma cobrar/pagar', async () => {
    let consultoFacturas = false;
    const prisma = {
      tenant: { findUnique: async () => ({ modules: ['facturacion', 'cuenta-corriente'] }) },
      factura: { findMany: async () => { consultoFacturas = true; return []; } },
      movimientoCuentaCorriente: {
        findMany: async ({ where }: Row) => {
          assert.equal(where.tenantId, 'org_A');
          return [
            {
              id: 'm1', clienteId: 'c1', contraparteId: 'c1', concepto: 'FACTURA A', numeroComprobante: '0003-00000094',
              importe: 1000, moneda: 'ARS', fechaVencimiento: dia(-2),
              cliente: { nombre: 'Agnone' }, proveedor: null, imputacionesComoCargo: [{ importe: 400 }],
            },
            {
              id: 'm2', clienteId: null, contraparteId: 'p1', concepto: 'LIQUIDO PRODUCTO', numeroComprobante: null,
              importe: 500, moneda: 'USD', fechaVencimiento: dia(1),
              cliente: null, proveedor: { nombre: 'Transportes Sur' }, imputacionesComoCargo: [],
            },
            {
              id: 'm3', clienteId: 'c1', contraparteId: 'c1', concepto: 'VENTA', numeroComprobante: 'X',
              importe: 100, moneda: 'ARS', fechaVencimiento: dia(1),
              cliente: { nombre: 'Saldado' }, proveedor: null, imputacionesComoCargo: [{ importe: 100 }],
            },
          ];
        },
      },
    };
    const items = await new VencimientosEvaluator(prisma as never).evaluar('org_A');
    assert.equal(consultoFacturas, false);
    assert.equal(items.length, 2);
    assert.equal(items[0].entidadId, 'm1:vencido');
    assert.equal(items[0].titulo, 'A cobrar: Agnone · FACTURA A 0003-00000094');
    assert.deepEqual(items[0].importe, { monto: 600, moneda: 'ARS', sentido: 'cobrar' });
    assert.equal(items[0].url, '/cuenta-corriente?tipo=cliente&id=c1');
    assert.equal(items[1].entidadId, 'm2:por-vencer');
    assert.equal(items[1].url, '/cuenta-corriente?tipo=proveedor&id=p1');
    assert.equal(items[1].importe?.sentido, 'pagar');
    assert.match(items[1].etiqueta ?? '', /^Vence mañana/);
  });

  await test('sin módulos de cobro: no evalúa nada', async () => {
    const prisma = { tenant: { findUnique: async () => ({ modules: ['combustible'] }) } };
    assert.deepEqual(await new VencimientosEvaluator(prisma as never).evaluar('org_A'), []);
  });

  await test('urlApp: agrega el # del HashRouter (sin él, "Not Found")', () => {
    assert.equal(urlApp('/cuenta-corriente'), 'https://admin.vialto.uno/#/cuenta-corriente');
    assert.equal(urlApp('facturacion?factura=1'), 'https://admin.vialto.uno/#/facturacion?factura=1');
    assert.equal(urlApp(), 'https://admin.vialto.uno/#/');
  });

  await test('email: asunto con resumen, totales por moneda, links con # y escapado', () => {
    const items = armarAvisosVencimientos(
      [
        { id: 'a', contraparte: '<Agnone & Cía>', sentido: 'cobrar', comprobante: 'FACTURA A 1', fechaVencimiento: dia(-1), saldo: 1000, moneda: 'ARS', url: '/cuenta-corriente?tipo=cliente&id=c1' },
        { id: 'b', contraparte: 'Otro', sentido: 'cobrar', comprobante: null, fechaVencimiento: dia(2), saldo: 500, moneda: 'ARS', url: '/x' },
        { id: 'c', contraparte: 'Sur', sentido: 'pagar', comprobante: null, fechaVencimiento: dia(2), saldo: 50, moneda: 'USD', url: '/y' },
      ],
      hoy,
    );
    const e = armarEmailNotificacion({
      label: 'Vencimientos de cobros y pagos', empresa: 'LSF', frecuencia: 'diaria', items, rutaBoton: '/cuenta-corriente',
    });
    assert.equal(e.subject, 'Vencimientos de cobros y pagos: 2 a cobrar a clientes, 1 a pagar a proveedores · LSF');
    assert.ok(e.html.includes('https://admin.vialto.uno/#/cuenta-corriente?tipo=cliente&amp;id=c1'));
    assert.ok(!e.html.includes('admin.vialto.uno/cuenta-corriente'));
    assert.ok(e.html.includes('&lt;Agnone &amp; Cía&gt;'));
    assert.ok(!e.html.includes('A cobrar · '), 'la fila no repite el lado (ya lo dice el bloque)');
    assert.ok(!e.html.includes('Ver todo'), 'sin "Ver todo": lo cubre el botón principal');
    assert.ok(e.html.includes('ARS 1.500,00'), 'total a cobrar suma ARS');
    assert.ok(e.html.includes('USD 50,00'), 'total a pagar en USD aparte');
    assert.ok(e.text.includes('https://admin.vialto.uno/#/configuracion/notificaciones'));
  });

  await test('email: tope de tarjetas con "Y N avisos más"', () => {
    const items = Array.from({ length: MAX_TARJETAS + 7 }, (_, i) => ({ entidadId: String(i), titulo: `T${i}`, detalle: 'd' }));
    const e = armarEmailNotificacion({ label: 'L', frecuencia: 'semanal', items, rutaBoton: '/' });
    assert.ok(e.html.includes('Y 7 avisos más'));
    assert.ok(!e.html.includes(`>T${MAX_TARJETAS}<`));
    assert.equal(e.subject, `L: ${MAX_TARJETAS + 7} avisos nuevos`);
    assert.ok(!e.html.includes('—') && !e.text.includes('—'), 'sin rayas largas en el email');
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
  console.log('\nTodas las pruebas pasaron');
})();
