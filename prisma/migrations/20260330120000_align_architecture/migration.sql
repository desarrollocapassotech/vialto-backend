-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cuit" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'basico',
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "billingStatus" TEXT NOT NULL DEFAULT 'trial',
    "billingRenewsAt" TIMESTAMP(3),
    "whiteLabelDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transportistas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'externo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transportistas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "choferes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dni" TEXT,
    "licencia" TEXT,
    "licenciaVence" TIMESTAMP(3),
    "telefono" TEXT,
    "transportistaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "choferes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patente" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "anio" INTEGER,
    "kmActual" INTEGER NOT NULL DEFAULT 0,
    "transportistaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viajes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "clienteId" TEXT NOT NULL,
    "transportistaId" TEXT,
    "choferId" TEXT,
    "vehiculoId" TEXT,
    "origen" TEXT,
    "destino" TEXT,
    "fechaSalida" TIMESTAMP(3),
    "fechaLlegada" TIMESTAMP(3),
    "mercaderia" TEXT,
    "kmRecorridos" INTEGER,
    "litrosConsumidos" DOUBLE PRECISION,
    "precioCliente" DOUBLE PRECISION,
    "precioFletero" DOUBLE PRECISION,
    "gananciaBruta" DOUBLE PRECISION,
    "documentacion" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "viajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "clienteId" TEXT,
    "viajeId" TEXT,
    "importe" DOUBLE PRECISION NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "diferencia" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facturaId" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "formaPago" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_cuenta_corriente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "saldoPost" DOUBLE PRECISION NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "referencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_cuenta_corriente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_stock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "pesoKg" DOUBLE PRECISION,
    "remito" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_combustible" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "choferId" TEXT,
    "estacion" TEXT NOT NULL,
    "litros" DOUBLE PRECISION NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "km" INTEGER NOT NULL,
    "formaPago" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "cargas_combustible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervenciones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "km" INTEGER,
    "proximoKm" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intervenciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remitos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "choferId" TEXT,
    "vehiculoId" TEXT,
    "descripcion" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "firmaUrl" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'emitido',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remitos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_clerkOrgId_key" ON "tenants"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cuit_key" ON "tenants"("cuit");

-- CreateIndex
CREATE INDEX "clientes_tenantId_idx" ON "clientes"("tenantId");

-- CreateIndex
CREATE INDEX "transportistas_tenantId_idx" ON "transportistas"("tenantId");

-- CreateIndex
CREATE INDEX "choferes_tenantId_idx" ON "choferes"("tenantId");

-- CreateIndex
CREATE INDEX "vehiculos_tenantId_idx" ON "vehiculos"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_tenantId_patente_key" ON "vehiculos"("tenantId", "patente");

-- CreateIndex
CREATE INDEX "viajes_tenantId_idx" ON "viajes"("tenantId");

-- CreateIndex
CREATE INDEX "viajes_tenantId_estado_idx" ON "viajes"("tenantId", "estado");

-- CreateIndex
CREATE INDEX "viajes_tenantId_clienteId_idx" ON "viajes"("tenantId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "viajes_tenantId_numero_key" ON "viajes"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "facturas_tenantId_idx" ON "facturas"("tenantId");

-- CreateIndex
CREATE INDEX "facturas_tenantId_clienteId_idx" ON "facturas"("tenantId", "clienteId");

-- CreateIndex
CREATE INDEX "facturas_tenantId_estado_idx" ON "facturas"("tenantId", "estado");

-- CreateIndex
CREATE INDEX "pagos_tenantId_idx" ON "pagos"("tenantId");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_idx" ON "movimientos_cuenta_corriente"("tenantId");

-- CreateIndex
CREATE INDEX "movimientos_cuenta_corriente_tenantId_clienteId_idx" ON "movimientos_cuenta_corriente"("tenantId", "clienteId");

-- CreateIndex
CREATE INDEX "productos_tenantId_idx" ON "productos"("tenantId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_idx" ON "movimientos_stock"("tenantId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_productoId_idx" ON "movimientos_stock"("tenantId", "productoId");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenantId_clienteId_idx" ON "movimientos_stock"("tenantId", "clienteId");

-- CreateIndex
CREATE INDEX "cargas_combustible_tenantId_idx" ON "cargas_combustible"("tenantId");

-- CreateIndex
CREATE INDEX "cargas_combustible_tenantId_vehiculoId_idx" ON "cargas_combustible"("tenantId", "vehiculoId");

-- CreateIndex
CREATE INDEX "intervenciones_tenantId_idx" ON "intervenciones"("tenantId");

-- CreateIndex
CREATE INDEX "intervenciones_tenantId_vehiculoId_idx" ON "intervenciones"("tenantId", "vehiculoId");

-- CreateIndex
CREATE INDEX "remitos_tenantId_idx" ON "remitos"("tenantId");

-- CreateIndex
CREATE INDEX "remitos_tenantId_clienteId_idx" ON "remitos"("tenantId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "remitos_tenantId_numero_key" ON "remitos"("tenantId", "numero");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportistas" ADD CONSTRAINT "transportistas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "choferes" ADD CONSTRAINT "choferes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "choferes" ADD CONSTRAINT "choferes_transportistaId_fkey" FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_transportistaId_fkey" FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_transportistaId_fkey" FOREIGN KEY ("transportistaId") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_choferId_fkey" FOREIGN KEY ("choferId") REFERENCES "choferes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "viajes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cuenta_corriente" ADD CONSTRAINT "movimientos_cuenta_corriente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_combustible" ADD CONSTRAINT "cargas_combustible_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_combustible" ADD CONSTRAINT "cargas_combustible_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_combustible" ADD CONSTRAINT "cargas_combustible_choferId_fkey" FOREIGN KEY ("choferId") REFERENCES "choferes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervenciones" ADD CONSTRAINT "intervenciones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervenciones" ADD CONSTRAINT "intervenciones_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remitos" ADD CONSTRAINT "remitos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("clerkOrgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remitos" ADD CONSTRAINT "remitos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remitos" ADD CONSTRAINT "remitos_choferId_fkey" FOREIGN KEY ("choferId") REFERENCES "choferes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remitos" ADD CONSTRAINT "remitos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
