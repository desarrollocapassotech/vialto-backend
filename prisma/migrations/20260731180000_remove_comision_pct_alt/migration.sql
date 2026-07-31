-- ArcaConfig.comisionPctAlt ("Comisión alternativa") nunca se leyó en ningún cálculo
-- de liquidación (ver liquidaciones.service.ts: comisionPct sale de dto > transportista
-- > comisionPctDefault); era un campo editable en la config pero muerto en la lógica.
ALTER TABLE "arca_configs" DROP COLUMN "comisionPctAlt";
