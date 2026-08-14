-- Factura.numero pasa a opcional: para tenants con integracion-arca el número
-- real lo asigna AFIP recién al emitir (cbteTipo/ptoVenta/cbteNro), no debe
-- exigirse al crear la factura borrador. Para tenants sin ARCA sigue siendo
-- el número real de un comprobante ya numerado externamente (obligatorio a
-- nivel de aplicación, no de schema).
ALTER TABLE "facturas" ALTER COLUMN "numero" DROP NOT NULL;

-- Vehiculo.patentePendiente: marca vehículos creados con patente placeholder
-- (PENDIENTE-xxxxxx) porque todavía no se cargó la patente real.
ALTER TABLE "vehiculos" ADD COLUMN "patentePendiente" BOOLEAN NOT NULL DEFAULT false;
