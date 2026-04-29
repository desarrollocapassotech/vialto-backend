-- Convierte todas las columnas que eran PostgreSQL ENUMs a TEXT para alinearlas
-- con el schema.prisma (que usa String). También agrega columnas faltantes.

-- tenants
ALTER TABLE "tenants" ALTER COLUMN "billingStatus" TYPE TEXT USING "billingStatus"::TEXT;
ALTER TABLE "tenants" ALTER COLUMN "billingStatus" SET DEFAULT 'trial';

-- vehiculos
ALTER TABLE "vehiculos" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- viajes
ALTER TABLE "viajes" ALTER COLUMN "estado" TYPE TEXT USING "estado"::TEXT;
ALTER TABLE "viajes" ALTER COLUMN "estado" SET DEFAULT 'pendiente';
ALTER TABLE "viajes" ALTER COLUMN "monedaMonto" TYPE TEXT USING "monedaMonto"::TEXT;
ALTER TABLE "viajes" ALTER COLUMN "monedaMonto" SET DEFAULT 'ARS';
ALTER TABLE "viajes" ALTER COLUMN "monedaPrecioTransportistaExterno" TYPE TEXT USING "monedaPrecioTransportistaExterno"::TEXT;
ALTER TABLE "viajes" ALTER COLUMN "monedaPrecioTransportistaExterno" SET DEFAULT 'ARS';

-- facturas
ALTER TABLE "facturas" ALTER COLUMN "estado" TYPE TEXT USING "estado"::TEXT;
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DEFAULT 'pendiente';
ALTER TABLE "facturas" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- import_logs
ALTER TABLE "import_logs" ALTER COLUMN "estado" TYPE TEXT USING "estado"::TEXT;
ALTER TABLE "import_logs" ALTER COLUMN "estado" SET DEFAULT 'completado';

-- intervenciones
ALTER TABLE "intervenciones" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- movimientos_cuenta_corriente
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "origen" TYPE TEXT USING "origen"::TEXT;
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "origen" SET DEFAULT 'manual';
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- movimientos_stock
ALTER TABLE "movimientos_stock" ALTER COLUMN "tipo" TYPE TEXT USING "tipo"::TEXT;

-- cargas_combustible
ALTER TABLE "cargas_combustible" ALTER COLUMN "formaPago" TYPE TEXT USING "formaPago"::TEXT;

-- pagos
ALTER TABLE "pagos" ALTER COLUMN "formaPago" TYPE TEXT USING "formaPago"::TEXT;

-- productos
ALTER TABLE "productos" ALTER COLUMN "unidad" TYPE TEXT USING "unidad"::TEXT;

-- remitos
ALTER TABLE "remitos" ALTER COLUMN "estado" TYPE TEXT USING "estado"::TEXT;
ALTER TABLE "remitos" ALTER COLUMN "estado" SET DEFAULT 'emitido';

-- Columnas faltantes
ALTER TABLE "transportistas" ADD COLUMN IF NOT EXISTS "tipo" TEXT NOT NULL DEFAULT 'externo';
ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "nroFactura" TEXT;

-- Eliminar tipos ENUM ya sin uso
DROP TYPE IF EXISTS "BillingStatus";
DROP TYPE IF EXISTS "EstadoFactura";
DROP TYPE IF EXISTS "EstadoImportLog";
DROP TYPE IF EXISTS "EstadoRemito";
DROP TYPE IF EXISTS "EstadoViaje";
DROP TYPE IF EXISTS "FormaPago";
DROP TYPE IF EXISTS "Moneda";
DROP TYPE IF EXISTS "OrigenMovimientoCuentaCorriente";
DROP TYPE IF EXISTS "TipoFactura";
DROP TYPE IF EXISTS "TipoIntervencion";
DROP TYPE IF EXISTS "TipoMovimientoCuentaCorriente";
DROP TYPE IF EXISTS "TipoMovimientoStock";
DROP TYPE IF EXISTS "TipoVehiculo";
DROP TYPE IF EXISTS "UnidadProducto";
