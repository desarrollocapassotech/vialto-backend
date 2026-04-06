-- Renombrar estado intermedio: finalizado_facturado → facturado_sin_cobrar
UPDATE "viajes" SET "estado" = 'facturado_sin_cobrar' WHERE "estado" = 'finalizado_facturado';
