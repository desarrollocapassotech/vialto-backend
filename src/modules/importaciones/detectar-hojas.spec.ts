/**
 * Pruebas de `ImportacionesService.detectarHojas` (qué módulos trae el Excel).
 * Usa las plantillas por defecto del catálogo, sin base de datos.
 * Ejecutar: npm run test:importaciones-detectar
 */
import * as assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { ImportacionesService } from "./importaciones.service";
import { ParserService } from "./engine/parser.service";
import { construirConfigPorDefecto } from "./template-catalogo";
import type { DeteccionHojasResult } from "./types/import.types";

function test(name: string, fn: () => Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      console.error(`✗ ${name}`);
      throw e;
    }
  })();
}

const prisma = {
  tenant: { findUnique: async () => ({ importacionesOcultas: false }) },
};
const svc = new (ImportacionesService as unknown as new (...args: unknown[]) => ImportacionesService)(
  prisma,
  new ParserService(),
  {}, {}, {}, {}, {}, {}, {}, {}, {},
);
(svc as unknown as { getActiveTemplate: unknown }).getActiveTemplate = async (
  _tenantId: string,
  modulo: string,
) => ({ template: { config: construirConfigPorDefecto(modulo) } });

function libro(hojas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const detectar = (b: Buffer): Promise<DeteccionHojasResult> =>
  svc.detectarHojas("org_test", b, false);
const resumen = (r: DeteccionHojasResult) =>
  r.hojas.map((h) => `${h.modulo}:${h.hoja}:${h.filas}:${h.detectadaPor}`);

const viajes = [
  ["Cliente", "Transporte", "Origen", "Destino", "Fecha carga", "Chofer"],
  ["A", "T", "X", "Y", "01/10/2026", "c"],
  ["B", "T", "X", "Y", "02/10/2026", "c"],
];
const clientes = [["Nombre", "CUIT", "Dirección", "Cond. IVA"], ["A", "20-1", "calle", "1"]];
const transportes = [["Nombre", "CUIT", "Domicilio", "PAUT"], ["T", "20-2", "x", "1"]];

(async () => {
  await test("Por nombre, en orden de importación; hojas vacías se ignoran", async () => {
    const r = await detectar(
      libro({ Viajes: viajes, Clientes: clientes, Transportes: transportes, Choferes: [["Nombre"]] }),
    );
    assert.deepEqual(resumen(r), [
      "clientes:Clientes:1:nombre",
      "transportistas:Transportes:1:nombre",
      "viajes:Viajes:2:nombre",
    ]);
    assert.deepEqual(r.sinIdentificar, []);
  });

  await test("Una sola hoja con otro nombre se reconoce por encabezados", async () => {
    const r = await detectar(libro({ Hoja1: viajes }));
    assert.deepEqual(resumen(r), ["viajes:Hoja1:2:encabezados"]);
  });

  await test("Varias hojas con nombres libres", async () => {
    const r = await detectar(libro({ "Planilla oct": viajes, Sheet2: clientes, Vacia: [] }));
    assert.deepEqual(resumen(r), ["clientes:Sheet2:1:encabezados", "viajes:Planilla oct:2:encabezados"]);
  });

  await test("Empate de encabezados vuelve como sin identificar con candidatos", async () => {
    const r = await detectar(libro({ Hoja1: [["Nombre"], ["Juan"]] }));
    assert.deepEqual(r.hojas, []);
    assert.equal(r.sinIdentificar[0].hoja, "Hoja1");
    assert.deepEqual([...r.sinIdentificar[0].candidatos].sort(), ["choferes", "clientes", "transportistas"]);
  });

  await test("Por nombre pero sin columnas obligatorias: vuelve con faltantes", async () => {
    const r = await detectar(libro({ Viajes: [["Cliente", "Origen"], ["A", "X"]] }));
    assert.equal(r.hojas[0].modulo, "viajes");
    assert.deepEqual(r.hojas[0].faltantes, ["Transporte", "Destino", "Fecha carga"]);
  });

  await test("Nombre exacto gana sobre parcial ('Viajes clientes' no es Clientes)", async () => {
    const r = await detectar(libro({ "Viajes clientes": viajes, Clientes: clientes }));
    assert.deepEqual(resumen(r), ["clientes:Clientes:1:nombre", "viajes:Viajes clientes:2:nombre"]);
  });

  await test("Hoja que no se parece a nada: sin identificar, sin candidatos", async () => {
    const r = await detectar(libro({ Datos: [["Foo", "Bar"], [1, 2]] }));
    assert.deepEqual(r.hojas, []);
    assert.deepEqual(r.sinIdentificar, [{ hoja: "Datos", filas: 1, candidatos: [] }]);
  });
})();
