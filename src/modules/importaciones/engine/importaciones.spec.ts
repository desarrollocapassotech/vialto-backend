/**
 * Pruebas del motor de importaciones (Parser y Validator).
 * Ejecutar: npm run test:importaciones
 */
import * as assert from "node:assert/strict";
import { ParserService } from "./parser.service";
import { ValidatorService } from "./validator.service";
import * as XLSX from "xlsx";
import type { TemplateConfig } from "../types/import.types";

function test(name: string, fn: () => void | Promise<void>) {
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

const parser = new ParserService();

function createDummyExcel(headers: string[], row: any[]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, row]);
  XLSX.utils.book_append_sheet(wb, ws, "Viajes");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const templateBase: TemplateConfig = {
  sheet: "Viajes",
  headerRow: 1,
  columns: [
    { field: "transportistaId", excelHeader: "Transporte", type: "lookup", lookupModel: "transportistas", lookupFields: ["nombre", "idFiscal"], createIfNotFound: true },
    { field: "precioTransportistaExterno", excelHeader: "Monto total a transportista (flete)", excelHeaderAliases: ["Pago neto"], type: "number" },
  ],
};

(async () => {
  await test("Parser: Excel con 'Monto total a transportista (flete)' sigue funcionando", () => {
    const buf = createDummyExcel(["Transporte", "Monto total a transportista (flete)"], ["Test", 150000]);
    const { rows } = parser.parse(buf, templateBase);
    assert.equal(rows[0].precioTransportistaExterno, 150000);
    assert.equal(rows[0]._unmappedText, null);
  });

  await test("Parser: Excel con 'Pago neto' se asigna correctamente por alias", () => {
    const buf = createDummyExcel(["Transporte", "Pago neto"], ["Test", 150000]);
    const { rows } = parser.parse(buf, templateBase);
    assert.equal(rows[0].precioTransportistaExterno, 150000);
    // Verificar que Pago neto no termine en observaciones
    assert.equal(rows[0]._unmappedText, null);
  });

  await test("Parser: Columna no mapeada va a _unmappedText", () => {
    const buf = createDummyExcel(["Transporte", "Pago neto", "Detalle extra"], ["Test", 150000, "Sin incidentes"]);
    const { rows } = parser.parse(buf, templateBase);
    assert.equal(rows[0].precioTransportistaExterno, 150000);
    assert.equal(rows[0]._unmappedText, "Detalle extra: Sin incidentes");
  });

  // Mock for ValidatorService
  const mockPrisma = {
    transportista: {
      findMany: async () => [{ id: "t1", nombre: "Juan", idFiscal: "20123456789" }],
      create: async (data: any) => ({ id: "new-t", ...data.data }),
    }
  } as any;
  const mockStock = {} as any;
  const validator = new ValidatorService(mockPrisma, mockStock);

  await test("Validator: Transportista existente por nombre", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["Juan"]), templateBase);
    const res = await validator.validate(rows, templateBase.columns, "tenant-1", "");
    assert.equal(res.valid[0].transportistaId, "t1");
  });

  await test("Validator: Transportista existente por CUIT", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["20123456789"]), templateBase);
    const res = await validator.validate(rows, templateBase.columns, "tenant-1", "");
    assert.equal(res.valid[0].transportistaId, "t1");
  });

  await test("Validator: Transportista inexistente + nombre -> autocrea", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["Transporte Nuevo"]), templateBase);
    const res = await validator.validate(rows, templateBase.columns, "tenant-1", "");
    assert.equal(res.valid[0].transportistaId, "new-t");
  });

  await test("Validator: Transportista inexistente + CUIT/DNI -> falla", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["20-11111111-9"]), templateBase);
    // Se reporta como error de fila (no excepción), para que el resto del archivo se pueda revisar.
    const res = await validator.validate(rows, templateBase.columns, "tenant-1", "");
    assert.equal(res.valid.length, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].campo, "Transporte");
  });

  await test("Validator: clientes — CUIT con dígito verificador inválido es error en el preview", async () => {
    const columns: TemplateConfig["columns"] = [
      { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
      { field: "pais", excelHeader: "País", type: "string" },
      { field: "idFiscal", excelHeader: "CUIT", type: "string" },
    ];
    const rows = [
      { _rowNum: 2, nombre: "OK", pais: "Argentina", idFiscal: "30-71674179-2" },
      { _rowNum: 3, nombre: "DV mal", pais: "AR", idFiscal: "30716741793" },
      { _rowNum: 4, nombre: "Corto", pais: "AR", idFiscal: "3071674179" },
      { _rowNum: 5, nombre: "Uruguay", pais: "UY", idFiscal: "211234560001" },
      { _rowNum: 6, nombre: "Sin CUIT", pais: "AR", idFiscal: "" },
    ] as any[];
    const res = await validator.validate(rows, columns, "tenant-1", "clientes");
    assert.deepEqual(res.valid.map((r) => r._rowNum), [2, 5, 6]);
    assert.deepEqual(res.errors.map((e) => [e.fila, e.campo]), [[3, "CUIT"], [4, "CUIT"]]);
    assert.match(res.errors[0].error, /dígito verificador/);
    assert.match(res.errors[1].error, /11 dígitos/);
  });
})();
