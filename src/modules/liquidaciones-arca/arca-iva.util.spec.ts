/**
 * Pruebas de alícuota IVA para PDF CVLP / autorización ARCA.
 * Ejecutar: npm run test:arca-iva
 */
import * as assert from 'node:assert/strict';
import {
  computeAfipGravadoIva,
  cvlpPdfPieFinanciero,
  formatAlicuotaIva,
  resolveIvaPct,
  round2,
  subtotalConIva,
} from './arca-iva.util';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('resolveIvaPct usa config y cae a 21', () => {
  assert.equal(resolveIvaPct(10.5), 10.5);
  assert.equal(resolveIvaPct(0), 0);
  assert.equal(resolveIvaPct(undefined), 21);
  assert.equal(resolveIvaPct(null), 21);
});

test('subtotalConIva no hardcodea 21% — alícuota 10.5%', () => {
  const ivaPct = 10.5;
  const flete = 1000;
  const comision = 80;

  const fleteCIva = subtotalConIva(flete, ivaPct);
  const comCIva = subtotalConIva(-comision, ivaPct);

  assert.equal(fleteCIva, 1105); // 1000 * 1.105
  assert.equal(comCIva, -88.4); // -80 * 1.105
  assert.notEqual(fleteCIva, round2(flete * 1.21));
  assert.equal(formatAlicuotaIva(ivaPct), '10,50');
});

test('PDF pie y CAE coinciden con alícuota distinta de 21%', () => {
  const ivaPct = 10.5;
  const bruto = 1000;
  const comision = 80;
  const gastosAdmin = 0;

  const autorizado = computeAfipGravadoIva(bruto, comision, gastosAdmin, ivaPct);
  // Simula lo persistido tras autorizar (gastosAdminIva = ImpIVA del CAE).
  const liq = {
    bruto,
    comision,
    gastosAdmin,
    gastosAdminIva: autorizado.impIva,
    liquido: autorizado.liquido,
  };

  const pie = cvlpPdfPieFinanciero(liq);
  assert.equal(pie.balances, true);
  assert.equal(
    round2(pie.netoGravado + pie.otrosTributos + pie.iva),
    pie.total,
  );
  assert.equal(pie.total, autorizado.liquido);
  assert.equal(pie.iva, autorizado.impIva);
  assert.equal(pie.netoGravado, autorizado.netoGravado);

  // Líneas del PDF con la misma alícuota suman el mismo neto/IVA del pie.
  const lineasNeto = round2(bruto - comision);
  const lineasConIva = round2(
    subtotalConIva(bruto, ivaPct) + subtotalConIva(-comision, ivaPct),
  );
  assert.equal(lineasNeto, pie.netoGravado);
  assert.equal(lineasConIva, pie.total);
});

test('caso 21% sigue funcionando', () => {
  const autorizado = computeAfipGravadoIva(1000, 100, 0, 21);
  assert.equal(autorizado.netoGravado, 900);
  assert.equal(autorizado.impIva, 189);
  assert.equal(autorizado.liquido, 1089);
  assert.equal(subtotalConIva(1000, 21), 1210);
  assert.equal(formatAlicuotaIva(21), '21,00');
});

test('PDF pie usa montos del cvlp (incluye conceptos)', () => {
  const liq = {
    bruto: 1000,
    comision: 100,
    gastosAdmin: 0,
    gastosAdminIva: 189, // desfasado a propósito (sin conceptos)
    liquido: 1089,
  };
  const cvlp = { impNeto: 950, impIva: 199.5, impTotal: 1149.5 };
  const pie = cvlpPdfPieFinanciero(liq, cvlp);
  assert.equal(pie.netoGravado, 950);
  assert.equal(pie.iva, 199.5);
  assert.equal(pie.total, 1149.5);
  assert.equal(pie.balances, true);
});

console.log('arca-iva.util.spec.ts: OK');
