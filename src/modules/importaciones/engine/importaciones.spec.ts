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
    const res = await validator.validate(rows, templateBase.columns, "tenant-1");
    assert.equal(res.valid[0].transportistaId, "t1");
  });

  await test("Validator: Transportista existente por CUIT", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["20123456789"]), templateBase);
    const res = await validator.validate(rows, templateBase.columns, "tenant-1");
    assert.equal(res.valid[0].transportistaId, "t1");
  });

  await test("Validator: Transportista inexistente + nombre -> autocrea", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["Transporte Nuevo"]), templateBase);
    const res = await validator.validate(rows, templateBase.columns, "tenant-1");
    assert.equal(res.valid[0].transportistaId, "new-t");
  });

  await test("Validator: Transportista inexistente + CUIT/DNI -> falla", async () => {
    const { rows } = parser.parse(createDummyExcel(["Transporte"], ["20-11111111-9"]), templateBase);
    let threw = false;
    try {
      await validator.validate(rows, templateBase.columns, "tenant-1");
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /No se puede crear automáticamente un transportista usando solo un DNI\/CUIT/);
    }
    assert.equal(threw, true);
  });
})();
