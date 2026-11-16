import * as assert from "assert";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
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

function validarCambioEtapa(
  viaje: {
    etapa: string;
    monto?: number | null;
    transportistaId?: string | null;
    precioTransportistaExterno?: number | null;
  },
  nuevaEtapa: string,
  userRole?: string | null,
) {
  if (userRole === "member" && viaje.etapa === "finalizado") {
    throw new ForbiddenException(
      "Los viajes finalizados solo pueden ser editados por administradores",
    );
  }

  if (nuevaEtapa === "finalizado") {
    const valorizacion = evaluarValorizacionViaje({
      monto: viaje.monto,
      transportistaId: viaje.transportistaId,
      precioTransportistaExterno: viaje.precioTransportistaExterno,
    });

    if (!valorizacion.valorizado) {
      if (valorizacion.faltaCliente && valorizacion.faltaTransportista) {
        throw new BadRequestException(
          "No se puede finalizar el viaje: faltan cargar los montos del cliente y del transportista.",
        );
      }
      if (valorizacion.faltaCliente) {
        throw new BadRequestException(
          "No se puede finalizar el viaje: falta cargar el monto del cliente.",
        );
      }
      if (valorizacion.faltaTransportista) {
        throw new BadRequestException(
          "No se puede finalizar el viaje: falta cargar el monto del transportista.",
        );
      }
    }
  }
}

test("rol member no puede cambiar la etapa de un viaje finalizado", () => {
  const viaje = {
    etapa: "finalizado",
    monto: 100000,
  };

  assert.throws(
    () => validarCambioEtapa(viaje, "en_curso", "member"),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenException);
      assert.equal(
        (err as ForbiddenException).message,
        "Los viajes finalizados solo pueden ser editados por administradores",
      );
      return true;
    },
  );
});

test("rol admin si puede cambiar la etapa de un viaje finalizado", () => {
  const viaje = {
    etapa: "finalizado",
    monto: 100000,
  };

  assert.doesNotThrow(() => validarCambioEtapa(viaje, "en_curso", "admin"));
});

test("cambiar a finalizado un viaje no valorizado falla con BadRequest", () => {
  const viaje = {
    etapa: "en_curso",
    monto: null,
    transportistaId: "transp-1",
    precioTransportistaExterno: null,
  };

  assert.throws(
    () => validarCambioEtapa(viaje, "finalizado", "member"),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      assert.match(
        (err as BadRequestException).message,
        /No se puede finalizar el viaje/,
      );
      return true;
    },
  );
});

test("cambiar a finalizado un viaje valorizado es exitoso para cualquier usuario", () => {
  const viaje = {
    etapa: "en_curso",
    monto: 150000,
    transportistaId: null,
  };

  assert.doesNotThrow(() => validarCambioEtapa(viaje, "finalizado", "member"));
});

test("cambiar de pendiente a en curso es exitoso", () => {
  const viaje = {
    etapa: "pendiente",
    monto: null,
  };

  assert.doesNotThrow(() => validarCambioEtapa(viaje, "en_curso", "member"));
});

test("cambiar a cancelado es exitoso", () => {
  const viaje = {
    etapa: "en_curso",
    monto: 100000,
  };

  assert.doesNotThrow(() => validarCambioEtapa(viaje, "cancelado", "member"));
});

console.log("viaje-etapa-cambio.spec.ts: OK");
