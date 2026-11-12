import * as assert from "node:assert/strict";
import { ViajesService } from "./viajes.service";
import type { PrismaService } from "@/prisma/prisma.service";

async function testFiltrosOpciones() {
  const findManyCalls: Array<{ where: any; select: any }> = [];

  const fakePrisma = {
    viaje: {
      findMany: async (args: any) => {
        findManyCalls.push(args);
        // Si pide clienteId
        if (args.select?.clienteId) {
          return [
            { clienteId: "cli-1", clientesViaje: [{ clienteId: "cli-2" }] },
            { clienteId: "cli-3", clientesViaje: [] },
            { clienteId: null, clientesViaje: [{ clienteId: "cli-4" }] },
          ];
        }
        // Si pide transportistaId
        if (args.select?.transportistaId) {
          return [
            { transportistaId: "transp-1", transportistaEfectivoId: null },
            { transportistaId: "transp-1", transportistaEfectivoId: "transp-2" },
          ];
        }
        // Si pide choferId
        if (args.select?.choferId) {
          return [{ choferId: "chofer-1" }, { choferId: "chofer-2" }, { choferId: null }];
        }
        return [];
      },
    },
  } as unknown as PrismaService;

  const service = new ViajesService(
    fakePrisma,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );

  const res = await service.filtrosOpciones("tenant-test", {
    clienteId: "cli-1",
    transportistaId: "transp-1",
    choferId: "chofer-1",
    facturacionEstado: "sin_facturar",
  });

  assert.equal(findManyCalls.length, 3, "Debe realizar 3 consultas en paralelo");

  // Consulta de clientes: debe haber omitido clienteId
  const callClientes = findManyCalls.find((c) => c.select?.clienteId);
  assert.ok(callClientes, "Debe consultar clientes");
  assert.equal(callClientes.where.clienteId, undefined, "No debe filtrar por clienteId en opciones de clientes");
  assert.equal(callClientes.where.choferId, "chofer-1", "Debe mantener choferId");

  // Consulta de transportistas: debe haber omitido transportistaId
  const callTransp = findManyCalls.find((c) => c.select?.transportistaId);
  assert.ok(callTransp, "Debe consultar transportistas");
  assert.equal(callTransp.where.transportistaId, undefined, "No debe filtrar por transportistaId en opciones de transportistas");
  assert.equal(callTransp.where.clienteId, "cli-1", "Debe mantener clienteId");

  // Consulta de choferes: debe haber omitido choferId
  const callChofer = findManyCalls.find((c) => c.select?.choferId);
  assert.ok(callChofer, "Debe consultar choferes");
  assert.equal(callChofer.where.choferId, undefined, "No debe filtrar por choferId en opciones de choferes");
  assert.equal(callChofer.where.clienteId, "cli-1", "Debe mantener clienteId");

  // Resultados procesados
  assert.deepEqual(res.clienteIds.sort(), ["cli-1", "cli-2", "cli-3", "cli-4"].sort());
  assert.deepEqual(res.transportistaIds.sort(), ["transp-1", "transp-2"].sort());
  assert.deepEqual(res.choferIds.sort(), ["chofer-1", "chofer-2"].sort());

  console.log("✓ filtrosOpciones: calcula opciones cruzadas omitiendo el propio campo correctamente");
}

(async () => {
  await testFiltrosOpciones();
})();
