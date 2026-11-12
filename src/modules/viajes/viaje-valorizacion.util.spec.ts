import * as assert from "node:assert/strict";
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

test("viaje con ambos montos cargados está valorizado", () => {
  const res = evaluarValorizacionViaje({
    monto: 150000,
    transportistaId: "transp-1",
    precioTransportistaExterno: 120000,
  });
  assert.equal(res.valorizado, true);
  assert.equal(res.faltaCliente, false);
  assert.equal(res.faltaTransportista, false);
  assert.equal(res.mensajePendiente, null);
});

test("viaje de flota propia sin transportista está valorizado con solo monto cliente", () => {
  const res = evaluarValorizacionViaje({
    monto: 200000,
    transportistaId: null,
  });
  assert.equal(res.valorizado, true);
  assert.equal(res.faltaCliente, false);
  assert.equal(res.faltaTransportista, false);
});

test("viaje con montos vacíos indica que faltan ambos montos", () => {
  const res = evaluarValorizacionViaje({
    monto: null,
    transportistaId: "transp-1",
    precioTransportistaExterno: null,
  });
  assert.equal(res.valorizado, false);
  assert.equal(res.faltaCliente, true);
  assert.equal(res.faltaTransportista, true);
  assert.equal(
    res.mensajePendiente,
    "Faltan cargar los montos del cliente y del transportista",
  );
});

test("viaje con solo monto de cliente indica que falta monto transportista", () => {
  const res = evaluarValorizacionViaje({
    monto: 350000,
    transportistaId: "transp-1",
    precioTransportistaExterno: null,
  });
  assert.equal(res.valorizado, false);
  assert.equal(res.faltaCliente, false);
  assert.equal(res.faltaTransportista, true);
  assert.equal(res.mensajePendiente, "Falta cargar el monto del transportista");
});

test("viaje con solo precio transportista indica que falta monto cliente", () => {
  const res = evaluarValorizacionViaje({
    monto: null,
    transportistaId: "transp-1",
    precioTransportistaExterno: 280000,
  });
  assert.equal(res.valorizado, false);
  assert.equal(res.faltaCliente, true);
  assert.equal(res.faltaTransportista, false);
  assert.equal(res.mensajePendiente, "Falta cargar el monto del cliente");
});

test("viaje con desglose (cantidad × precio unitario) evalúa correctamente", () => {
  const res = evaluarValorizacionViaje({
    cantidadFactura: 30,
    precioUnitarioFactura: 5000,
    transportistaId: "transp-1",
    cantidadTransportista: 30,
    precioUnitarioTransportista: 4000,
  });
  assert.equal(res.valorizado, true);
});

test("viaje multi-cliente con cliente adicional sin monto no está valorizado", () => {
  const res = evaluarValorizacionViaje({
    monto: 100000,
    transportistaId: null,
    clientesViaje: [{ monto: null }],
  });
  assert.equal(res.valorizado, false);
  assert.equal(res.faltaCliente, true);
});

console.log("viaje-valorizacion.util.spec.ts: OK");

