/**
 * Pruebas de alícuota IVA para PDF CVLP / autorización ARCA.
 * Ejecutar: npm run test:arca-iva
 */
import * as assert from 'node:assert/strict';
import {
  computeAfipGravadoIva,
  cvlpPdfPieFinanciero,
  formatAlicuotaIva,
  groupAlicuotasIva,
  ivaIdFromPct,
  normalizeIvaPct,
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

test('ivaIdFromPct mapea tasas AFIP conocidas', () => {
  assert.equal(ivaIdFromPct(0), 3);
  assert.equal(ivaIdFromPct(2.5), 9);
  assert.equal(ivaIdFromPct(5), 8);
  assert.equal(ivaIdFromPct(10.5), 4);
  assert.equal(ivaIdFromPct(21), 5);
  assert.equal(ivaIdFromPct(27), 6);
  assert.equal(ivaIdFromPct(10.5000001), 4); // Float DB
  assert.equal(normalizeIvaPct(21.0000002), 21);
});

test('groupAlicuotasIva totaliza por Id y recalcula Importe = BaseImp × %', () => {
  // Varias líneas a 21% → un solo AlicIva; IVA sobre el neto (no suma de IVAs por línea)
  const mismo = groupAlicuotasIva([
    { importeBase: 1000, ivaPct: 21, importeIva: 210 },
    { importeBase: -80, ivaPct: 21, importeIva: -16.8 },
    { importeBase: -50, ivaPct: 21.0000001, importeIva: -10.5 },
  ]);
  assert.equal(mismo.length, 1);
  assert.equal(mismo[0].Id, 5);
  assert.equal(mismo[0].BaseImp, 870);
  assert.equal(mismo[0].Importe, round2((870 * 21) / 100));

  // Caso que AFIP rechazaba (10051): suma de IVAs por línea ≠ BaseImp × %
  const desvioCentavos = groupAlicuotasIva([
    { importeBase: 200.06, ivaPct: 21, importeIva: 42.01 },
    { importeBase: -100.03, ivaPct: 21, importeIva: -21.01 },
  ]);
  assert.equal(desvioCentavos.length, 1);
  assert.equal(desvioCentavos[0].BaseImp, 100.03);
  // Suma de IVAs línea = 21.00; correcto AFIP = 100.03 * 0.21 = 21.01
  assert.equal(desvioCentavos[0].Importe, 21.01);
  assert.notEqual(desvioCentavos[0].Importe, 21.0);

  // 21% + 10.5% ambos positivos → dos Ids
  const mixtasPos = groupAlicuotasIva([
    { importeBase: 1000, ivaPct: 21 },
    { importeBase: 200, ivaPct: 10.5 },
  ]);
  assert.equal(mixtasPos.length, 2);
  const byId = Object.fromEntries(mixtasPos.map((a) => [a.Id, a]));
  assert.equal(byId[5].Importe, round2((1000 * 21) / 100));
  assert.equal(byId[4].Importe, round2((200 * 10.5) / 100));

  // 21% positivo + 10.5% negativo → consolidar (no enviar BaseImp ≤ 0)
  const mixtas = groupAlicuotasIva([
    { importeBase: 1000, ivaPct: 21, importeIva: 210 },
    { importeBase: -100, ivaPct: 10.5, importeIva: -10.5 },
  ]);
  assert.equal(mixtas.length, 1);
  assert.equal(mixtas[0].Id, 5);
  assert.equal(mixtas[0].BaseImp, 900);
  assert.equal(mixtas[0].Importe, round2((900 * 21) / 100));

  // 5% y 21% no colapsan en el mismo Id
  const cincoY21 = groupAlicuotasIva([
    { importeBase: 1000, ivaPct: 21 },
    { importeBase: -100, ivaPct: 5 },
  ]);
  // Descuento a otra alícuota → se consolida (AFIP 10020: BaseImp debe ser > 0)
  assert.equal(cincoY21.length, 1);
  assert.equal(cincoY21[0].Id, 5);
  assert.equal(cincoY21[0].BaseImp, 900);
  assert.equal(cincoY21[0].Importe, round2((900 * 21) / 100));
  assert.ok(cincoY21.every((a) => a.BaseImp > 0));

  // Descuento a 0% no puede generar AlicIva con BaseImp negativo
  const descExento = groupAlicuotasIva(
    [
      { importeBase: 1000, ivaPct: 21 },
      { importeBase: -80, ivaPct: 21 },
      { importeBase: -50, ivaPct: 0 },
    ],
    { fallbackIvaPct: 21 },
  );
  assert.equal(descExento.length, 1);
  assert.equal(descExento[0].BaseImp, 870);
  assert.ok(descExento[0].BaseImp > 0);
});

console.log('arca-iva.util.spec.ts: OK');
