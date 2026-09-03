-- Elimina el trigger obsoleto que referenciaba movimientos_stock.remitoId,

DROP TRIGGER IF EXISTS trg_movimiento_stock_tenant_check ON movimientos_stock;
DROP FUNCTION IF EXISTS trg_fn_movimiento_stock_tenant_check;
