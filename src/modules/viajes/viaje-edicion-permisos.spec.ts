import * as assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { evaluarValorizacionViaje } from "./viaje-valorizacion.util";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

function validarPermisoEdicionViaje(
  viaje: Parameters<typeof evaluarValorizacionViaje>[0],
  userRole?: string | null,
) {
  if (userRole === "member") {
    const valorizacionActual = evaluarValorizacionViaje(viaje);
    if (valorizacionActual.valorizado) {
      throw new ForbiddenException(
        "Los viajes valorizados solo pueden ser editados por administradores",
      );
    }
  }
}

test("rol member no puede editar un viaje valorizado", () => {
  const viaje = {
    monto: 150000,
    transportistaId: "transp-1",
    precioTransportistaExterno: 120000,
  };

  assert.throws(
    () => validarPermisoEdicionViaje(viaje, "member"),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenException);
      assert.equal(
        (err as ForbiddenException).message,
        "Los viajes valorizados solo pueden ser editados por administradores",
      );
      return true;
    },
  );
});

test("rol member puede editar un viaje que todavia no esta valorizado", () => {
  const viaje = {
    monto: null,
    transportistaId: "transp-1",
    precioTransportistaExterno: null,
  };

  assert.doesNotThrow(() => validarPermisoEdicionViaje(viaje, "member"));
});

test("rol member puede editar un viaje que tiene solo monto de cliente pero falta transportista", () => {
  const viaje = {
    monto: 150000,
    transportistaId: "transp-1",
    precioTransportistaExterno: null,
  };

  assert.doesNotThrow(() => validarPermisoEdicionViaje(viaje, "member"));
});

test("rol admin puede editar un viaje aunque este valorizado", () => {
  const viaje = {
    monto: 150000,
    transportistaId: "transp-1",
    precioTransportistaExterno: 120000,
  };

  assert.doesNotThrow(() => validarPermisoEdicionViaje(viaje, "admin"));
});

test("rol superadmin puede editar un viaje aunque este valorizado", () => {
  const viaje = {
    monto: 150000,
    transportistaId: "transp-1",
    precioTransportistaExterno: 120000,
  };

  assert.doesNotThrow(() => validarPermisoEdicionViaje(viaje, "superadmin"));
});

test("un viaje no valorizado no se bloquea para member aunque este finalizado", () => {
  const viaje = {
    monto: null,
    transportistaId: null,
    precioTransportistaExterno: null,
    etapa: "finalizado",
  };

  assert.doesNotThrow(() => validarPermisoEdicionViaje(viaje, "member"));
});

console.log("viaje-edicion-permisos.spec.ts: OK");

