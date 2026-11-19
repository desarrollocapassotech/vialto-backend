import * as assert from "node:assert/strict";
import { resolverMontoInput } from "./viaje-montos.util";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test("monto plano sin desglose: respeta el monto directo enviado", () => {
  // Empresa sin desglose envía monto plano y los campos de desglose en null
  const res = resolverMontoInput(1000, null, null);
  assert.equal(res, 1000);
});

test("monto plano sin desglose vaciado: persiste null", () => {
  const res = resolverMontoInput(null, null, null);
  assert.equal(res, null);
});

test("con desglose completo: calcula cantidad x precio unitario", () => {
  const res = resolverMontoInput(undefined, 2.5, 100);
  assert.equal(res, 250);

  // Si viniera monto directo diferente, prevalece el cálculo del desglose
  const resConDirecto = resolverMontoInput(100, 3, 50);
  assert.equal(resConDirecto, 150);
});

test("vaciado de desglose sin enviar monto directo: resuelve null", () => {
  const res = resolverMontoInput(undefined, null, null);
  assert.equal(res, null);
});

test("actualizacion parcial sin tocar montos: respeta undefined", () => {
  const res = resolverMontoInput(undefined, undefined, undefined);
  assert.equal(res, undefined);
});

console.log("viaje-montos.util.spec.ts: OK");
