-- Renombrar mercaderia → detalleCarga (API y UI: "detalle de carga")
ALTER TABLE "viajes" RENAME COLUMN "mercaderia" TO "detalleCarga";
