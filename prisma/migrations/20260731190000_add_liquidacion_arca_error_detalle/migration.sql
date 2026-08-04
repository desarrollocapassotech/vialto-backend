-- Liquidacion.arcaErrorDetalle: detalle técnico crudo del último error de AFIP SDK,
-- para mostrar "ver error completo" en el frontend (ArcaErrorMessage) sin mezclarlo
-- con el mensaje amigable ya existente en arcaError.
ALTER TABLE "liquidaciones" ADD COLUMN "arcaErrorDetalle" TEXT;
