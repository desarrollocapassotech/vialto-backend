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
      return validatorNombres.validate(rows, templateBase.columns, "tenant-1", "");
    };
    assert.equal((await validar("Fava Diego")).valid[0]?.transportistaId, "fava");
    // Dos "Peralta Marcos …": no se asigna automáticamente ni se autocrea, y se informa ambigüedad.
    const resAmbiguo = await validar("Peralta Marcos");
    assert.equal(resAmbiguo.valid.length, 0);
    assert.equal(resAmbiguo.errors.length, 1);
    assert.match(resAmbiguo.errors[0].error, /más de una coincidencia/i);
    assert.equal(resAmbiguo.errors[0].lookupModel, undefined);
    // Una sola palabra no alcanza para vincular.
    assert.equal((await validar("Fava")).valid[0]?.transportistaId, "new-t");
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

  await test("Preview y confirm de choferes: DNI repetido en el mismo archivo (directo o dentro del CUIT) se marca como DNI repetido y se omite", async () => {
    const choferesDB: { id: string; nombre: string; dni: string | null; cuit: string | null }[] = [
      { id: "ch-existente", nombre: "FERNANDEZ JUAN CARLOS", dni: "40841857", cuit: null },
    ];
    let savedSession: any = null;
    const prismaChoferesMock = {
      tenant: {
        findUnique: async () => ({
          importacionesOcultas: false,
          paisOrigenDestinoOculto: false,
          paisOrigenDestinoCodigo: null,
        }),
      },
      importTemplate: {
        findFirst: async () => ({
          id: "tpl-choferes",
          modulo: "choferes",
          config: {
            sheet: "Choferes",
            headerRow: 1,
            columns: [
              { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
              { field: "dni", excelHeader: "DNI", type: "string" },
              { field: "cuit", excelHeader: "CUIT", type: "string" },
            ],
          },
        }),
      },
      chofer: {
        findMany: async () => choferesDB,
        findFirst: async ({ where }: any) => {
          if (where?.nombre?.equals) {
            return (
              choferesDB.find(
                (c) => c.nombre.toLowerCase() === where.nombre.equals.toLowerCase(),
              ) ?? null
            );
          }
          return null;
        },
        create: async ({ data }: any) => {
          const created = {
            id: `ch-${choferesDB.length + 1}`,
            nombre: data.nombre,
            dni: data.dni ?? null,
            cuit: data.cuit ?? null,
          };
          choferesDB.push(created);
          return { id: created.id };
        },
      },
      transportista: {
        findMany: async () => [],
      },
      $queryRaw: async () => [],
      importSession: {
        create: async ({ data }: any) => {
          savedSession = {
            id: "sess-ch-1",
            ...data,
            template: {
              modulo: "choferes",
              config: {
                columns: [
                  { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
                  { field: "dni", excelHeader: "DNI", type: "string" },
                  { field: "cuit", excelHeader: "CUIT", type: "string" },
                ],
              },
            },
          };
          return { id: "sess-ch-1" };
        },
        findFirst: async () => savedSession,
        delete: async () => ({}),
      },
      importLog: {
        create: async ({ data }: any) => ({ id: "log-ch-1", ...data }),
      },
    } as any;

    const clientesProcessor = new ClientesProcessor(prismaChoferesMock);
    const transportistasProcessor = new TransportistasProcessor(prismaChoferesMock);
    const choferesProcessor = new ChoferesProcessor(prismaChoferesMock);
    const validatorChoferes = new ValidatorService(prismaChoferesMock, {} as any);
    const service = new ImportacionesService(
      prismaChoferesMock,
      parser,
      validatorChoferes,
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
      ["Nombre", "DNI", "CUIT"],
      ["FERNANDEZ J CARLOS", "40841857", ""],
      ["CHOFER NUEVO SOLO DNI", "37904686", ""],
      ["CHOFER REPETIDO EN ARCHIVO A", "37555884", ""],
      ["CHOFER REPETIDO EN ARCHIVO B", "", "20375558840"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Choferes");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const preview = await service.preview(
      "tenant-1",
      "choferes",
      buffer,
      "choferes.xlsx",
      true,
    );

    // Fila 2 choca contra el chofer existente en DB
    assert.deepEqual(
      preview.advertenciasCampoUnicoDuplicado?.map((c) => c.fila),
      [2],
    );
    // Fila 5 es repetida de la fila 4 (mismo DNI dentro del CUIT) y siempre usa campoLabel "DNI"
    const fila4 = preview.filasDetalle?.find((f) => f.fila === 4);
    const fila5 = preview.filasDetalle?.find((f) => f.fila === 5);
    assert.equal(fila4?.esNuevo, true);
    assert.equal(fila4?.repetidaEnArchivo, undefined);
    assert.equal(fila5?.esNuevo, false);
    assert.deepEqual(fila5?.repetidaEnArchivo, {
      campoLabel: "DNI",
      valor: "20375558840",
      filaOriginal: 4,
      nombreOriginal: "CHOFER REPETIDO EN ARCHIVO A",
    });
    // Solo las filas 3 y 4 son realmente nuevas
    assert.equal(preview.entidadesNuevas, 2);
    assert.equal(preview.entidadesActualizadas, 0);

    const confirmRes = await service.confirm(
      "tenant-1",
      "sess-ch-1",
      "user-1",
      true,
      undefined,
      undefined,
      true,
      [{ fila: 2, accion: "ignorar" }],
    );
    assert.equal(confirmRes.errores, 0);
    assert.equal(confirmRes.exitosas, 2);
    const omitida5 = (confirmRes.detalles as any[]).find((d) => d.fila === 5);
    assert.equal(omitida5?.estado, "omitida");
    assert.match(omitida5?.mensaje ?? "", /mismo DNI que la fila 4/);
  });

  await test("Validator en Viajes (createIfNotFound=false): nombres abreviados con única coincidencia se vinculan y múltiples coincidencias se informan como ambiguas", async () => {
    const columnsViajes: TemplateConfig["columns"] = [
      { field: "clienteId", excelHeader: "Cliente", type: "lookup", lookupModel: "clientes", lookupFields: ["idFiscal", "nombre"], required: true },
      { field: "transportistaId", excelHeader: "Transporte", type: "lookup", lookupModel: "transportistas", lookupFields: ["idFiscal", "nombre"], required: true },
      { field: "choferId", excelHeader: "Chofer", type: "lookup", lookupModel: "choferes", lookupFields: ["dni", "cuit", "nombre"] },
      { field: "fechaCarga", excelHeader: "Fecha carga", type: "date", required: true },
    ];
    const validatorViajes = new ValidatorService(
      {
        tenant: {
          findUnique: async () => ({
            idSistemaHabilitado: true,
            labelIdentificacionPersonalizadaViajes: "ID propio",
          }),
        },
        cliente: {
          findMany: async () => [
            { id: "c-agro", nombre: "Agroinsumos del Sur SA", idFiscal: "30715566776" },
            { id: "c-pampa", nombre: "Cereales Pampa SRL", idFiscal: "30711223341" },
          ],
        },
        transportista: {
          findMany: async () => [
            { id: "t-lopez", nombre: "LOPEZ MARCELO JAVIER", idFiscal: "20245678909" },
          ],
        },
        chofer: {
          findMany: async () => [
            { id: "ch-fernandez", nombre: "FERNANDEZ JUAN CARLOS", dni: "40841957", cuit: "20408419574" },
            { id: "ch-martinez-1", nombre: "MARTINEZ DIEGO ALBERTO", dni: "31222333", cuit: "20312223339" },
            { id: "ch-martinez-2", nombre: "MARTINEZ DIEGO FERNANDO", dni: "35444555", cuit: "20354445553" },
          ],
        },
      } as any,
      mockStock,
    );

    const rows = [
      { _rowNum: 2, clienteId: "Agroinsumos del Sur SA", transportistaId: "Lopez Marcelo", choferId: "FERNANDEZ JUAN CARLOS", fechaCarga: new Date("2026-10-01T00:00:00Z") },
      { _rowNum: 3, clienteId: "Cereales Pampa", transportistaId: "LOPEZ MARCELO JAVIER", choferId: "FERNANDEZ JUAN CARLOS", fechaCarga: new Date("2026-10-03T00:00:00Z") },
      { _rowNum: 4, clienteId: "Agroinsumos del Sur SA", transportistaId: "LOPEZ MARCELO JAVIER", choferId: "Fernandez Juan", fechaCarga: new Date("2026-10-05T00:00:00Z") },
      { _rowNum: 7, clienteId: "Agroinsumos del Sur SA", transportistaId: "LOPEZ MARCELO JAVIER", choferId: "Martinez Diego", fechaCarga: new Date("2026-10-11T00:00:00Z") },
      { _rowNum: 9, clienteId: "Agroinsumos del Sur SA", transportistaId: "LOPEZ MARCELO JAVIER", choferId: "Gomez Pedro", fechaCarga: new Date("2026-10-15T00:00:00Z") },
    ] as any[];

    const res = await validatorViajes.validate(rows, columnsViajes, "tenant-1", "viajes", true);

    assert.deepEqual(res.valid.map((r) => r._rowNum), [2, 3, 4]);
    assert.equal(res.valid[0].transportistaId, "t-lopez");
    assert.equal(res.valid[1].clienteId, "c-pampa");
    assert.equal(res.valid[2].choferId, "ch-fernandez");

    const errorFila7 = res.errors.find((e) => e.fila === 7);
    assert.ok(errorFila7);
    assert.match(errorFila7.error, /más de una coincidencia/i);
    assert.match(errorFila7.error, /MARTINEZ DIEGO ALBERTO/);
    assert.match(errorFila7.error, /MARTINEZ DIEGO FERNANDO/);
    assert.equal(errorFila7.lookupModel, undefined);
    assert.equal(errorFila7.valoresNoEncontrados, undefined);

    const errorFila9 = res.errors.find((e) => e.fila === 9);
    assert.ok(errorFila9);
    assert.equal(errorFila9.lookupModel, "choferes");
    assert.deepEqual(errorFila9.valoresNoEncontrados, [{ valor: "Gomez Pedro", posicion: 0 }]);
  });

  await test("CUIT con puntos: se acepta en clientes, transportistas y choferes y se guarda normalizado sin puntos ni guiones", async () => {
    const columnsFiscal: TemplateConfig["columns"] = [
      { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
      { field: "idFiscal", excelHeader: "CUIT", type: "string" },
      { field: "pais", excelHeader: "País", type: "string" },
    ];
    const columnsChoferes: TemplateConfig["columns"] = [
      { field: "nombre", excelHeader: "Nombre", type: "string", required: true },
      { field: "dni", excelHeader: "DNI", type: "string" },
      { field: "cuit", excelHeader: "CUIT", type: "string" },
    ];

    const resClientes = await validator.validate(
      [{ _rowNum: 2, nombre: "Molinos Río Segundo SRL", idFiscal: "33.66736090.6", pais: "Argentina" }],
      columnsFiscal,
      "tenant-1",
      "clientes",
      true,
    );
    assert.equal(resClientes.errors.length, 0);
    assert.equal(resClientes.valid.length, 1);

    const resTransportistas = await validator.validate(
      [{ _rowNum: 2, nombre: "EXPRESO SURESTE SRL", idFiscal: "30.68991122.2", pais: "Argentina" }],
      columnsFiscal,
      "tenant-1",
      "transportistas",
      true,
    );
    assert.equal(resTransportistas.errors.length, 0);
    assert.equal(resTransportistas.valid.length, 1);

    const resChoferes = await validator.validate(
      [{ _rowNum: 2, nombre: "SUAREZ DIEGO HERNAN", dni: "30588511", cuit: "20.30588511.9" }],
      columnsChoferes,
      "tenant-1",
      "choferes",
      true,
    );
    assert.equal(resChoferes.errors.length, 0);
    assert.equal(resChoferes.valid.length, 1);

    let clienteCreado: any = null;
    let transportistaCreado: any = null;
    let choferCreado: any = null;
    const prismaInsertMock = {
      cliente: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          clienteCreado = data;
          return { id: "c-1" };
        },
      },
      transportista: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          transportistaCreado = data;
          return { id: "t-1" };
        },
      },
      chofer: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          choferCreado = data;
          return { id: "ch-1" };
        },
      },
      $queryRaw: async () => [],
    } as any;

    await new ClientesProcessor(prismaInsertMock).insert(resClientes.valid[0], "tenant-1", "user-1");
    await new TransportistasProcessor(prismaInsertMock).insert(resTransportistas.valid[0], "tenant-1", "user-1");
    await new ChoferesProcessor(prismaInsertMock).insert(resChoferes.valid[0], "tenant-1", "user-1");

    assert.equal(clienteCreado?.idFiscal, "33667360906");
    assert.equal(transportistaCreado?.idFiscal, "30689911222");
    assert.equal(choferCreado?.cuit, "20305885119");
  });
})();
