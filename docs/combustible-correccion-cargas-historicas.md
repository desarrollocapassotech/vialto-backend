# Corrección de cargas de combustible históricas — análisis y decisiones

Contexto: tras migrar las cargas históricas de Bressan desde Firestore
(`scripts/migrate-bressan-cargas.ts`, ver `docs/comb-02-mapeo-firebase-vialto.md`),
se detectó que una parte relevante de los registros tiene `litros` y/o `importe`
incoherentes — producto de errores de carga manual en el origen, no de la migración
en sí (la migración es de solo lectura sobre Firestore).

Implementación de referencia: `scripts/fix-combustible-cargas-sospechosas.ts`

---

## Diagnóstico (sobre 2043 cargas de Bressan, QA)

| Criterio | Cantidad | % |
|---|---|---|
| `litros >= 100.000` (físicamente imposible) | 498 | 24% |
| `importe <= 0` | 146 | 7% |
| precio/litro (`importe / litros`) fuera de $900–3500 | 503 | 25% |
| **Total con algún problema** | **1133** | **55%** |

El rango $900–3500 surge de un dato provisto por el negocio: el precio del
combustible, desde que se empezaron a registrar cargas hasta hoy, osciló entre
ARS 1000 y ARS 3000 (se usa 900–3500 como banda con margen).

**No está concentrado en el pasado — está empeorando.** Distribución mensual del
% de cargas sospechosas:

| Período | % sospechoso |
|---|---|
| Feb–Mar 2025 (inicio) | 31–40% |
| Abr 2025 – Mar 2026 | ~47–58% |
| Abr–Jul 2026 (más reciente) | **68–79%** |

Conclusión: el problema no es exclusivamente histórico, la causa de origen (carga
manual) sigue activa y generando registros sospechosos cada mes. La corrección de
la entrada de datos (UI) queda fuera de este alcance pero es una prioridad aparte.

---

## Regla de corrección automática (única, sin excepciones por fila)

Para el grupo de `litros >= 100.000`, se probó dividir por distintos factores
(÷10, ÷100, ÷1000, ÷10.000, ÷100.000) buscando que el resultado caiga en un rango
físico plausible (5–1000 litros) **y** que el precio/litro resultante caiga en
$900–3500, simultáneamente:

| Factor | Casos que resuelven ambas condiciones |
|---|---|
| ÷10, ÷100, ÷100.000 | 0 |
| **÷1000** | **402 de 484** (83%) |
| ÷10.000 | 6 |
| Sin ningún factor | 76 (16%) |

Un único factor fijo (÷1000) explica al 83% del grupo — señal de una causa
mecánica sistemática (probablemente litros con 3 decimales cuyo separador se
perdió en algún punto del pipeline de origen), no corrupción aleatoria por fila.

**Por qué es una corrección legítima y no "ajustar el número hasta que quede
lindo":** se aplica como regla global fija (÷1000 para todo el grupo), no como
búsqueda de factor por fila — eso sí sería fabricar datos. Los casos que no caen
en rango con ÷1000 (ni con ningún otro factor limpio) **no se fuerzan** — quedan
sospechosos.

El valor original se conserva siempre en `litrosOriginal` para trazabilidad.

---

## Qué se corrige automáticamente vs. qué queda sospechoso

| Caso | Acción |
|---|---|
| `litros >= 100.000` y ÷1000 cae en rango plausible + precio/litro válido | **Corrige**: `litros = litros / 1000`, guarda `litrosOriginal` |
| `litros >= 100.000` sin factor limpio | Sospechosa (`motivoSospecha = 'litros_extremo'`) |
| `importe <= 0` | Sospechosa (`motivoSospecha = 'importe_invalido'`) — sin corrección posible |
| precio/litro fuera de $900–3500 (y no cae en los casos anteriores) | Sospechosa (`motivoSospecha = 'precio_litro_fuera_de_rango'`) — sin corrección posible, no hay un factor único que explique este grupo |

## Decisión sobre lo irrecuperable

No hay comprobantes originales (papel/digital) a los que volver para reconstruir
los valores, y aunque los hubiera, el volumen (cientos de registros) hace
inviable una revisión manual uno por uno. **Decisión: las cargas sospechosas sin
corrección automática se marcan y se excluyen de reportes/promedios/dashboards de
combustible, sin intentar reconstruir el valor.**

> **Abierto / no decidido todavía:** si el dashboard de combustible debe mostrar
> un contador de "X cargas excluidas de este período" junto a los promedios, para
> que no parezca un número completo cuando en realidad excluye una porción
> importante de los datos (especialmente en los meses recientes, donde la tasa de
> sospechosas ronda el 70%). La exclusión en sí ya está implementada (ver
> "Estado actual" más abajo); lo que falta decidir es solo si se comunica visualmente.

---

## Estado actual

- **Script corrido en QA (2026-07-15).** Sobre 2049 cargas de Bressan procesadas:
  **402 corregidas** (÷1000, con `litrosOriginal` guardado) y **732 marcadas
  sospechosas** (96 `litros_extremo`, 132 `importe_invalido`, 504
  `precio_litro_fuera_de_rango`). Verificado contra la base — coincide exacto con
  el dry-run previo.
- **Dashboard actualizado (`combustible.service.ts`)** para excluir
  `sospechoso: true` de todos los cálculos agregados: totales del resumen,
  distribución por estación/forma de pago, ranking por vehículo, ranking por
  chofer, evolución de precio, evolución de costo por km, comparación vs. período
  anterior, proyección del mes y `getStats`. Motivó este cambio un pico irreal en
  el gráfico de costo/km causado por una carga con `importe` de $84 millones que
  el script ya había marcado sospechosa pero el dashboard todavía no filtraba.
  Se dejaron **sin filtrar a propósito** los listados crudos (`findAll`,
  exportación a Excel, "últimas cargas" del dashboard) para que el operador
  pueda seguir viendo y revisando el dato marcado, no solo los promedios.
- Este cambio de `combustible.service.ts` está commiteado localmente pero
  **todavía no pusheado/mergeado** — ver pendientes.

---

## Pendiente

1. **Correr el script en producción.** Solo se ejecutó en QA hasta ahora
   (`npm run fix:combustible:dry` y `fix:combustible` apuntando a la rama
   `production` de Neon). Recomendado ensayar antes contra un branch temporal de
   Neon clonado de producción.
2. **Pushear/mergear los cambios pendientes de `combustible.service.ts`**
   (exclusión de sospechosas en el dashboard) — commiteados en local, sin subir.
3. **Definir el contador de "excluidas" en el dashboard** (ver nota de arriba) —
   sin esto, un usuario puede ver un promedio calculado sobre una fracción chica
   de las cargas del período (hasta ~70-80% excluido en meses recientes) sin
   ninguna señal visual de que faltan datos.
4. **La causa de origen (carga manual) sigue sin resolverse** y, según el
   diagnóstico, empeorando mes a mes (68–79% de tasa de error en abr–jul 2026).
   Cuanto más se posterga, más cargas nuevas van a necesitar este mismo
   tratamiento — vale la pena revisarlo como prioridad aparte, no solo como
   limpieza histórica.

## Campos agregados a `CargaCombustible` (Prisma)

```prisma
sospechoso      Boolean @default(false)
motivoSospecha  String? // litros_extremo | importe_invalido | precio_litro_fuera_de_rango
litrosOriginal  Float?  // valor previo a la corrección automática (÷1000), null si nunca se corrigió
```

Aplicado en QA vía migración `20260715184915_carga_combustible_flag_sospechoso`.

---

## Uso del script

No toca Firestore — solo lee y escribe en PostgreSQL vía Prisma. El mismo script
sirve para QA y para producción; lo que cambia es a qué rama de Neon apunta
`DATABASE_URL` en el momento de correrlo.

```bash
npm run fix:combustible:dry                      # preview en el entorno activo
npm run fix:combustible                          # aplica los cambios
npm run fix:combustible -- --tenant-id org_xxx   # limita a un tenant puntual
```

Es **idempotente**: solo procesa cargas con `sospechoso = false` y
`litrosOriginal = null` (nunca antes tocadas). Correr de nuevo no repite trabajo
ni pisa correcciones ya aplicadas — sirve tanto para el pase histórico como para
pasadas periódicas mientras la causa de origen (carga manual) siga activa.

Flujo recomendado: correr `--dry-run` y `fix:combustible` primero en QA, validar
el resumen y una muestra de las cargas corregidas, y recién después repetir en
producción (opcionalmente ensayando antes contra un branch temporal de Neon
clonado de producción, como se hizo para la migración de schema).
