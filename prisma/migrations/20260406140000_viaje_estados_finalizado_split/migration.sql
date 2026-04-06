-- Antiguo estado `finalizado` → `finalizado_sin_facturar` (misma semántica operativa).
UPDATE "viajes" SET "estado" = 'finalizado_sin_facturar' WHERE "estado" = 'finalizado';
