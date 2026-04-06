-- Renombrar estado terminal: finalizado_cobrado → cobrado
UPDATE "viajes" SET "estado" = 'cobrado' WHERE "estado" = 'finalizado_cobrado';
