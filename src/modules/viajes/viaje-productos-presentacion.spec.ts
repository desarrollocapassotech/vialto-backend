import * as assert from "node:assert";
import { reemplazarProductosDelViaje } from "./viaje-vehiculos.helper";
import { normalizarClientesDelViaje } from "./viaje-clientes.helper";

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
      { productoId: "prod-1", cantidad: 10, presentacionId: "pres-1" },
      { productoId: "prod-2", cantidad: 5, presentacionId: "  " },
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
    },
    {
      tenantId: "tenant-1",
      viajeId: "viaje-1",
      productoId: "prod-2",
      presentacionId: null,
      orden: 1,
      cantidad: 5,
      pesoKg: null,
    },
    {
      tenantId: "tenant-1",
      viajeId: "viaje-1",
      productoId: "prod-3",
      presentacionId: null,
      orden: 2,
      cantidad: 1,
      pesoKg: null,
    },
  ]);
  console.log("✓ reemplazarProductosDelViaje persiste presentacionId correctamente");
}

function testNormalizarClientesProductos() {
  const normalizados = normalizarClientesDelViaje([
    {
      clienteId: "cli-1",
      productos: [
        { productoId: "prod-1", cantidad: 20, presentacionId: "pres-pallets" },
        { productoId: "prod-2", cantidad: 4, presentacionId: undefined },
      ],
    },
  ]);

  assert.equal(normalizados.length, 1);
  assert.equal(normalizados[0].productos.length, 2);
  assert.equal(normalizados[0].productos[0].presentacionId, "pres-pallets");
  assert.equal(normalizados[0].productos[1].presentacionId, null);
  console.log("✓ normalizarClientesDelViaje preserva presentacionId en productos de clientes");
}

async function run() {
  await testReemplazarProductos();
  testNormalizarClientesProductos();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
