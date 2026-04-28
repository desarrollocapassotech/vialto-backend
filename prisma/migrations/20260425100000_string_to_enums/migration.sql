-- CO2: Convertir columnas String con valores enum a tipos ENUM de PostgreSQL
-- Se crean los tipos y se alteran las columnas con USING para castear los datos existentes.

-- ─────────────────────────────────────────────────────────────────────────────
-- Crear tipos ENUM
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "BillingStatus" AS ENUM ('trial', 'active', 'suspended', 'expired');
CREATE TYPE "TipoVehiculo" AS ENUM ('tractor', 'semirremolque', 'camion', 'utilitario', 'otro');
CREATE TYPE "EstadoViaje" AS ENUM ('pendiente', 'en_curso', 'finalizado_sin_facturar', 'facturado_sin_cobrar', 'cobrado', 'cancelado');
CREATE TYPE "Moneda" AS ENUM ('ARS', 'USD');
CREATE TYPE "TipoFactura" AS ENUM ('cliente', 'transportista_externo');
CREATE TYPE "EstadoFactura" AS ENUM ('pendiente', 'cobrada', 'vencida');
CREATE TYPE "FormaPago" AS ENUM ('transferencia', 'cheque', 'efectivo');
CREATE TYPE "TipoMovimientoCuentaCorriente" AS ENUM ('cargo', 'pago');
CREATE TYPE "OrigenMovimientoCuentaCorriente" AS ENUM ('manual', 'viaje');
CREATE TYPE "UnidadProducto" AS ENUM ('kg', 'unidad', 'palet', 'rollo', 'otro');
CREATE TYPE "TipoMovimientoStock" AS ENUM ('ingreso', 'egreso', 'division');
CREATE TYPE "TipoIntervencion" AS ENUM ('service', 'aceite', 'filtro', 'cubiertas', 'otro');
CREATE TYPE "EstadoRemito" AS ENUM ('emitido', 'firmado', 'facturado');
CREATE TYPE "EstadoImportLog" AS ENUM ('completado', 'con_errores', 'fallido');

-- tenants
ALTER TABLE "tenants" ALTER COLUMN "billingStatus" DROP DEFAULT;
ALTER TABLE "tenants" ALTER COLUMN "billingStatus" TYPE "BillingStatus" USING "billingStatus"::"BillingStatus";
ALTER TABLE "tenants" ALTER COLUMN "billingStatus" SET DEFAULT 'trial'::"BillingStatus";

-- vehiculos
ALTER TABLE "vehiculos" ALTER COLUMN "tipo" TYPE "TipoVehiculo" USING "tipo"::"TipoVehiculo";

-- viajes
ALTER TABLE "viajes" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "viajes" ALTER COLUMN "estado" TYPE "EstadoViaje" USING "estado"::"EstadoViaje";
ALTER TABLE "viajes" ALTER COLUMN "estado" SET DEFAULT 'pendiente'::"EstadoViaje";

ALTER TABLE "viajes" ALTER COLUMN "monedaMonto" DROP DEFAULT;
ALTER TABLE "viajes" ALTER COLUMN "monedaMonto" TYPE "Moneda" USING "monedaMonto"::"Moneda";
ALTER TABLE "viajes" ALTER COLUMN "monedaMonto" SET DEFAULT 'ARS'::"Moneda";

ALTER TABLE "viajes" ALTER COLUMN "monedaPrecioTransportistaExterno" DROP DEFAULT;
ALTER TABLE "viajes" ALTER COLUMN "monedaPrecioTransportistaExterno" TYPE "Moneda" USING "monedaPrecioTransportistaExterno"::"Moneda";
ALTER TABLE "viajes" ALTER COLUMN "monedaPrecioTransportistaExterno" SET DEFAULT 'ARS'::"Moneda";

-- facturas
ALTER TABLE "facturas" ALTER COLUMN "tipo" TYPE "TipoFactura" USING "tipo"::"TipoFactura";

ALTER TABLE "facturas" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "facturas" ALTER COLUMN "estado" TYPE "EstadoFactura" USING "estado"::"EstadoFactura";
ALTER TABLE "facturas" ALTER COLUMN "estado" SET DEFAULT 'pendiente'::"EstadoFactura";

-- pagos
ALTER TABLE "pagos" ALTER COLUMN "formaPago" TYPE "FormaPago" USING "formaPago"::"FormaPago";

-- movimientos_cuenta_corriente
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "tipo" TYPE "TipoMovimientoCuentaCorriente" USING "tipo"::"TipoMovimientoCuentaCorriente";

ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "origen" DROP DEFAULT;
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "origen" TYPE "OrigenMovimientoCuentaCorriente" USING "origen"::"OrigenMovimientoCuentaCorriente";
ALTER TABLE "movimientos_cuenta_corriente" ALTER COLUMN "origen" SET DEFAULT 'manual'::"OrigenMovimientoCuentaCorriente";

-- productos
ALTER TABLE "productos" ALTER COLUMN "unidad" TYPE "UnidadProducto" USING "unidad"::"UnidadProducto";

-- movimientos_stock
ALTER TABLE "movimientos_stock" ALTER COLUMN "tipo" TYPE "TipoMovimientoStock" USING "tipo"::"TipoMovimientoStock";

-- cargas_combustible
ALTER TABLE "cargas_combustible" ALTER COLUMN "formaPago" TYPE "FormaPago" USING "formaPago"::"FormaPago";

-- intervenciones
ALTER TABLE "intervenciones" ALTER COLUMN "tipo" TYPE "TipoIntervencion" USING "tipo"::"TipoIntervencion";

-- remitos
ALTER TABLE "remitos" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "remitos" ALTER COLUMN "estado" TYPE "EstadoRemito" USING "estado"::"EstadoRemito";
ALTER TABLE "remitos" ALTER COLUMN "estado" SET DEFAULT 'emitido'::"EstadoRemito";

-- import_logs
ALTER TABLE "import_logs" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "import_logs" ALTER COLUMN "estado" TYPE "EstadoImportLog" USING "estado"::"EstadoImportLog";
ALTER TABLE "import_logs" ALTER COLUMN "estado" SET DEFAULT 'completado'::"EstadoImportLog";
