-- ArcaConfig.anulacionTipoComprobante existe en schema.prisma y ya está aplicado en la
-- base (columna real, en uso desde arca-config.service.ts), pero nunca se commiteó la
-- carpeta de migración correspondiente. Este archivo solo documenta el cambio; se marca
-- como aplicado con `prisma migrate resolve --applied` en vez de ejecutarse, porque la
-- columna ya existe en develop.
ALTER TABLE "arca_configs" ADD COLUMN "anulacionTipoComprobante" TEXT NOT NULL DEFAULT 'nota_credito';
