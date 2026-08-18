-- Viaje.precioTransportistaIncluyeIva: si es true, precioTransportistaExterno ya
-- incluye IVA (lo que efectivamente pagó/paga el transportista), y no hay que
-- volver a sumarle el IVA que calcula una Liquidación ARCA vinculada — evita el
-- saldo negativo que se generaba al registrar pagos por el monto total con IVA
-- contra un acordado calculado sin IVA.
ALTER TABLE "viajes" ADD COLUMN "precioTransportistaIncluyeIva" BOOLEAN NOT NULL DEFAULT false;
