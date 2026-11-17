/**
 * Pruebas del IVA por tramo en el pago al transportista.
 * Ejecutar: npm run test:tramos-transportista
 */
import * as assert from 'node:assert/strict';
import {
  engrosarConIva,
  ivaTransportista,
  partesIvaTransportista,
  validarTramosTransportista,
} from './viaje-tramos-transportista.util';
import { computeLiquidacionTotales } from '../../modules/liquidaciones-arca/cvlp-conceptos.util';

let fallos = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

test('sin tramos: mismo resultado que siempre', () => {
  assert.equal(engrosarConIva(1100000, 21), 1331000);
  assert.equal(engrosarConIva(2700, 6.6), 2878.2);
  assert.equal(engrosarConIva(1000, 0), 1000);
  assert.equal(engrosarConIva(1000, null, []), 1000);
  assert.equal(engrosarConIva(1000, 21, undefined), 1210);
});

test('ejemplo LSF: 1.000 con tramo uruguayo de 200 al 22% → IVA 44', () => {
  const tramos = [{ detalle: 'Tramo Uruguay', monto: 200, ivaPct: 22 }];
  assert.equal(ivaTransportista(1000, 0, tramos), 44);
  assert.equal(engrosarConIva(1000, 0, tramos), 1044);
  assert.deepEqual(partesIvaTransportista(1000, 0, tramos), [
    { base: 200, ivaPct: 22 },
    { base: 800, ivaPct: 0 },
  ]);
});

test('el resto no cubierto usa el % general del viaje', () => {
  const tramos = [{ detalle: 'A', monto: 300, ivaPct: 22 }];
  // 300 × 22% = 66; 700 × 10% = 70
  assert.equal(ivaTransportista(1000, 10, tramos), 136);
});

test('tramos que cubren todo el neto: no hay resto', () => {
  const tramos = [
    { detalle: 'AR', monto: 600, ivaPct: 0 },
    { detalle: 'UY', monto: 400, ivaPct: 22 },
  ];
  assert.deepEqual(partesIvaTransportista(1000, 21, tramos), [
    { base: 600, ivaPct: 0 },
    { base: 400, ivaPct: 22 },
  ]);
  assert.equal(ivaTransportista(1000, 21, tramos), 88);
});

test('validación', () => {
  assert.equal(validarTramosTransportista([], 1000), null);
  assert.equal(validarTramosTransportista(undefined, 1000), null);
  assert.equal(
    validarTramosTransportista([{ detalle: 'UY', monto: 200, ivaPct: 22 }], 1000),
    null,
  );
  assert.match(
    validarTramosTransportista([{ detalle: 'UY', monto: 1200, ivaPct: 22 }], 1000) ?? '',
    /no puede superar/,
  );
  assert.match(
    validarTramosTransportista([{ detalle: '', monto: 200, ivaPct: 22 }], 1000) ?? '',
    /descripción/,
  );
  assert.match(
    validarTramosTransportista([{ detalle: 'UY', monto: 0, ivaPct: 22 }], 1000) ?? '',
    /incompleto/,
  );
  assert.match(
    validarTramosTransportista([{ detalle: 'UY', monto: 200, ivaPct: 22 }], 0) ?? '',
    /precio del transportista/,
  );
});

test('liquidación: un viaje con tramos suma el IVA de cada tramo', () => {
  const r = computeLiquidacionTotales({
    bruto: 1000,
    comision: 0,
    ivaPctDefault: 21,
    viajes: [
      {
        id: 'v1',
        numero: '1',
        bruto: 1000,
        comision: 0,
        tramosIva: [
          { base: 200, ivaPct: 22 },
          { base: 800, ivaPct: 0 },
        ],
      },
    ],
  });
  assert.equal(r.impIva, 44);
  assert.equal(r.liquido, 1044);
});

test('liquidación: un viaje sin tramos queda igual que antes', () => {
  const r = computeLiquidacionTotales({
    bruto: 2700,
    comision: 0,
    ivaPctDefault: 21,
    viajes: [{ id: 'v1', numero: '1', bruto: 2700, comision: 0, ivaPct: 6.6 }],
  });
  assert.equal(r.impIva, 178.2);
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron');
