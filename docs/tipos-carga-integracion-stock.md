# Tipos de carga (viajes) — integración futura con Stock

## Objetivo

El modelo `TipoCarga` cataloga la carga transportable asociada a viajes (`Viaje.tipoCargaId`). Es independiente del modelo `Producto` del módulo Stock (movimientos por cliente y remitos), pero está pensado para converger sin migraciones disruptivas.

## Extensión recomendada

1. **Fase inicial (actual):** campos base en columnas (`nombre`, `unidadMedida`, `activo`, etc.) y `metadata` JSON vacío por defecto.
2. **Antes de columnas nuevas en BD:** usar `metadata` para prototipos (`codigoSKU`, `categoria`, `stockMinimo`, `productoId` de enlace al `Producto` de stock, etc.) y validarlos en servicio.
3. **Cuando un campo sea estable y transversal:** agregar columna opcional en `tipos_carga` con migración acotada (`DEFAULT NULL` / backfill seguro), y seguir leyendo `metadata` como respaldo durante la transición si hace falta.

## Reglas

- No borrar filas del catálogo en duro: los viajes históricos mantienen FK; solo baja lógica (`activo = false`).
- Nuevas relaciones Stock ↔ tipo de carga deben respetar `tenantId` y no exponer IDs cruzados sin validación en backend.
