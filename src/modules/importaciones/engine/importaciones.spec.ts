/**
 * Pruebas del motor de importaciones (Parser y Validator).
 * Ejecutar: npm run test:importaciones
 */
import * as assert from "node:assert/strict";
import { ParserService } from "./parser.service";
import { ValidatorService } from "./validator.service";
import { ImportacionesService } from "../importaciones.service";
import { ClientesProcessor } from "../processors/clientes.processor";
import { TransportistasProcessor } from "../processors/transportistas.processor";
import { ChoferesProcessor } from "../processors/choferes.processor";
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

  await test("Validator: nombre abreviado de un transportista existente -> se vincula, no se duplica", async () => {
    const validatorNombres = new ValidatorService(
      {
        transportista: {
          findMany: async () => [
            { id: "fava", nombre: "FAVA DIEGO ABEL", idFiscal: "20263972202" },
            { id: "p1", nombre: "Peralta Marcos Alejandro", idFiscal: "20346837153" },
            { id: "p2", nombre: "Peralta Marcos Luis", idFiscal: "20111111112" },
          ],
          create: async (data: any) => ({ id: "new-t", ...data.data }),
        },
      } as any,
      mockStock,
    );
    const validar = async (valor: string) => {
      const { rows } = parser.parse(createDummyExcel(["Transporte"], [valor]), templateBase);
      return (await validatorNombres.validate(rows, templateBase.columns, "tenant-1", "")).valid[0]
        .transportistaId;
    };
    assert.equal(await validar("Fava Diego"), "fava");
    // Dos "Peralta Marcos …": no se puede saber cuál es → se crea como antes.
    assert.equal(await validar("Peralta Marcos"), "new-t");
    // Una sola palabra no alcanza para vincular.
    assert.equal(await validar("Fava"), "new-t");
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

  await test("Validator: país fijo — se completa solo aunque falte la columna o traiga otro país", async () => {
    const columns: TemplateConfig["columns"] = [
      { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
      { field: "pais", excelHeader: "País", type: "string", valorFijo: "AR" },
    ];
    const rows = [
      { _rowNum: 2, nombre: "Sin columna país" },
      { _rowNum: 3, nombre: "Con otro país", pais: "Uruguay" },
    ] as any[];
    const res = await validator.validate(rows, columns, "tenant-1", "clientes");
    assert.equal(res.errors.length, 0);
    assert.deepEqual(res.valid.map((r) => r.pais), ["AR", "AR"]);
  });

  const columnaProducto: TemplateConfig["columns"] = [
    { field: "productoId", excelHeader: "Producto", type: "lookup", lookupModel: "productos", lookupFields: ["nombre", "codigo"], createIfNotFound: true },
  ];
  const validatorProductos = new ValidatorService(
    { producto: { findMany: async () => [{ id: "p-soja", nombre: "Soja", codigo: "P-001" }] } } as any,
    {} as any,
  );

  await test("Validator: producto existente se encuentra sin importar acentos ni mayúsculas", async () => {
    const rows = [
      { _rowNum: 2, productoId: "SOJA" },
      { _rowNum: 3, productoId: "  sója " },
    ] as any[];
    const res = await validatorProductos.validate(rows, columnaProducto, "tenant-1", "", true);
    assert.equal(res.errors.length, 0);
    assert.deepEqual(res.valid.map((r) => r.productoId), ["p-soja", "p-soja"]);
  });

  await test("Validator: producto inexistente se crea una sola vez aunque varíe acento/mayúsculas", async () => {
    const rows = [
      { _rowNum: 2, productoId: "Maíz" },
      { _rowNum: 3, productoId: "MAIZ" },
      { _rowNum: 4, productoId: "maiz" },
    ] as any[];
    const res = await validatorProductos.validate(rows, columnaProducto, "tenant-1", "", true);
    assert.equal(res.errors.length, 0);
    assert.deepEqual(res.created.productos, ["Maíz"]);
    assert.equal(new Set(res.valid.map((r) => r.productoId)).size, 1);
  });

  await test("Preview y confirm de clientes: CUIT repetido en el mismo archivo con distinto formato se marca y se omite", async () => {
    const clientesDB: { id: string; nombre: string; idFiscal: string; pais: string }[] = [
      { id: "c-existente", nombre: "Agroinsumos del Sur SA", idFiscal: "30608371180", pais: "AR" },
    ];
    let savedSession: any = null;
    let savedLog: any = null;
    const prismaClientesMock = {
      tenant: {
        findUnique: async () => ({
          importacionesOcultas: false,
          paisOrigenDestinoOculto: false,
          paisOrigenDestinoCodigo: null,
        }),
      },
      importTemplate: {
        findFirst: async () => ({
          id: "tpl-clientes",
          modulo: "clientes",
          config: {
            sheet: "Clientes",
            headerRow: 1,
            columns: [
              { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
              { field: "idFiscal", excelHeader: "CUIT", type: "string" },
              { field: "pais", excelHeader: "País", type: "string" },
            ],
          },
        }),
      },
      cliente: {
        findMany: async ({ where }: any) => {
          if (where?.idFiscal?.in) {
            return clientesDB.filter((c) => where.idFiscal.in.includes(c.idFiscal));
          }
          return clientesDB;
        },
        findFirst: async ({ where }: any) => {
          if (where?.nombre?.equals) {
            return (
              clientesDB.find(
                (c) => c.nombre.toLowerCase() === where.nombre.equals.toLowerCase(),
              ) ?? null
            );
          }
          if (where?.idFiscal) {
            return clientesDB.find((c) => c.idFiscal === where.idFiscal) ?? null;
          }
          return null;
        },
        create: async ({ data }: any) => {
          const created = {
            id: `c-${clientesDB.length + 1}`,
            nombre: data.nombre,
            idFiscal: data.idFiscal,
            pais: data.pais ?? "AR",
          };
          clientesDB.push(created);
          return { id: created.id };
        },
      },
      importSession: {
        create: async ({ data }: any) => {
          savedSession = {
            id: "sess-1",
            ...data,
            template: {
              modulo: "clientes",
              config: {
                columns: [
                  { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
                  { field: "idFiscal", excelHeader: "CUIT", type: "string" },
                  { field: "pais", excelHeader: "País", type: "string" },
                ],
              },
            },
          };
          return { id: "sess-1" };
        },
        findFirst: async () => savedSession,
        delete: async () => ({}),
      },
      importLog: {
        create: async ({ data }: any) => {
          savedLog = { id: "log-1", ...data };
          return savedLog;
        },
      },
    } as any;

    const clientesProcessor = new ClientesProcessor(prismaClientesMock);
    const transportistasProcessor = new TransportistasProcessor(prismaClientesMock);
    const choferesProcessor = new ChoferesProcessor(prismaClientesMock);
    const validatorClientes = new ValidatorService(prismaClientesMock, {} as any);
    const service = new ImportacionesService(
      prismaClientesMock,
      parser,
      validatorClientes,
      {} as any,
      clientesProcessor,
      transportistasProcessor,
      choferesProcessor,
      {} as any,
      {} as any,
      {} as any,
      { getConfig: async () => ({ hiddenFields: {} }) } as any,
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nombre", "CUIT", "País"],
      ["Cliente Duplicado Mismo Formato", "30608371180", "Argentina"],
      ["Cliente Duplicado Con Guiones", "30-60837118-0", "Argentina"],
      ["Cliente Nuevo Valido", "33571385207", "Argentina"],
      ["Cliente Repetido En Archivo A", "30607228228", "Argentina"],
      ["Cliente Repetido En Archivo B", "30-60722822-8", "Argentina"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const preview = await service.preview(
      "tenant-1",
      "clientes",
      buffer,
      "clientes.xlsx",
      true,
    );

    // Filas 2 y 3 chocan contra el cliente existente en DB
    assert.deepEqual(
      preview.advertenciasCampoUnicoDuplicado?.map((c) => c.fila),
      [2, 3],
    );
    // Fila 6 es repetida de la fila 5 dentro del mismo archivo
    const fila5 = preview.filasDetalle?.find((f) => f.fila === 5);
    const fila6 = preview.filasDetalle?.find((f) => f.fila === 6);
    assert.equal(fila5?.esNuevo, true);
    assert.equal(fila5?.repetidaEnArchivo, undefined);
    assert.equal(fila6?.esNuevo, false);
    assert.deepEqual(fila6?.repetidaEnArchivo, {
      campoLabel: "CUIT",
      valor: "30-60722822-8",
      filaOriginal: 5,
      nombreOriginal: "Cliente Repetido En Archivo A",
    });
    // Solo las filas 4 y 5 son realmente nuevas (2, 3 tienen conflicto con DB y 6 está repetida en archivo)
    assert.equal(preview.entidadesNuevas, 2);
    assert.equal(preview.entidadesActualizadas, 0);

    // Al confirmar ignorando las filas 2 y 3, la fila 6 se omite sola y no falla
    const confirmRes = await service.confirm(
      "tenant-1",
      "sess-1",
      "user-1",
      true,
      undefined,
      undefined,
      true,
      [
        { fila: 2, accion: "ignorar" },
        { fila: 3, accion: "ignorar" },
      ],
    );
    assert.equal(confirmRes.errores, 0);
    assert.equal(confirmRes.exitosas, 2);
    const omitida6 = (confirmRes.detalles as any[]).find((d) => d.fila === 6);
    assert.equal(omitida6?.estado, "omitida");
    assert.match(omitida6?.mensaje ?? "", /mismo CUIT que la fila 5/);
  });
})();
