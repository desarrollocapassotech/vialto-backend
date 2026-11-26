import * as assert from "node:assert";
import { reemplazarProductosDelViaje } from "./viaje-vehiculos.helper";
import { normalizarClientesDelViaje } from "./viaje-clientes.helper";
import { FIELD_CATALOG } from "../../core/tenant-field-config/field-catalog";

async function testReemplazarProductos() {
  const calls: any[] = [];
  const fakeDb: any = {
    viajeProducto: {
      deleteMany: async (args: any) => {
        calls.push({ action: "deleteMany", args });
      },
      createMany: async (args: any) => {
        calls.push({ action: "createMany", args });
      },
    },
  };

  await reemplazarProductosDelViaje(
    fakeDb,
    "viaje-1",
    [
      { productoId: "prod-1", cantidad: 10, pesoTn: 0.7, presentacionId: "pres-1" },
      { productoId: "prod-2", cantidad: 5, pesoTn: 1.25, presentacionId: "  " },
      { productoId: "prod-3", cantidad: 1 },
    ],
    "tenant-1",
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { action: "deleteMany", args: { where: { viajeId: "viaje-1" } } });
  assert.deepEqual(calls[1].args.data, [
    {
      tenantId: "tenant-1",
      viajeId: "viaje-1",
      productoId: "prod-1",
      presentacionId: "pres-1",
      orden: 0,
      cantidad: 10,
      pesoKg: null,
      pesoTn: 0.7,
    },
    {
      tenantId: "tenant-1",
      viajeId: "viaje-1",
      productoId: "prod-2",
      presentacionId: null,
      orden: 1,
      cantidad: 5,
      pesoKg: null,
      pesoTn: 1.25,
    },
    {
      tenantId: "tenant-1",
      viajeId: "viaje-1",
      productoId: "prod-3",
      presentacionId: null,
      orden: 2,
      cantidad: 1,
      pesoKg: null,
      pesoTn: null,
    },
  ]);
  console.log("✓ reemplazarProductosDelViaje persiste presentacionId y pesoTn correctamente");
}

function testNormalizarClientesProductos() {
  const normalizados = normalizarClientesDelViaje([
    {
      clienteId: "cli-1",
      productos: [
        { productoId: "prod-1", cantidad: 20, pesoTn: 0.7, presentacionId: "pres-pallets" },
        { productoId: "prod-2", cantidad: 4, presentacionId: undefined },
      ],
    },
  ]);

  assert.equal(normalizados.length, 1);
  assert.equal(normalizados[0].productos.length, 2);
  assert.equal(normalizados[0].productos[0].presentacionId, "pres-pallets");
  assert.equal(normalizados[0].productos[0].pesoTn, 0.7);
  assert.equal(normalizados[0].productos[1].presentacionId, null);
  assert.equal(normalizados[0].productos[1].pesoTn, null);
  console.log("✓ normalizarClientesDelViaje preserva presentacionId y pesoTn en productos de clientes");
}

function testCatalogoPesoCargaOptIn() {
  for (const form of ["alta_viaje", "edicion_viaje", "detalle_viaje"] as const) {
    const def = FIELD_CATALOG.viajes.formularios[form].campos.find(
      (c) => c.campo === "pesoCarga",
    );
    assert.ok(def, `Falta pesoCarga en ${form}`);
    assert.equal(def.obligatorioSistema, false);
    assert.equal(def.defaultVisible, false);
  }
  console.log("✓ field-catalog registra pesoCarga como campo opt-in apagado por defecto");
}

async function run() {
  await testReemplazarProductos();
  testNormalizarClientesProductos();
  testCatalogoPesoCargaOptIn();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
