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

---

## Km — segunda dimensión del problema (encontrada después, vía el dashboard)

Después de arreglar litros/importe, la tarjeta "Precio prom. / km" del dashboard
seguía mostrando valores irreales ($74 en vez de $200-500 esperado). Causa: el
campo `km` (odómetro) tiene el mismo tipo de error de carga manual que litros,
pero nunca se lo había revisado — el flag `sospechoso` solo miraba litros/importe.

A diferencia de litros, `km` es una **secuencia por vehículo**, no un valor
independiente por fila: no alcanza con mirar la carga sola, hay que compararla
contra sus vecinas físicas (anterior y siguiente del mismo vehículo por fecha).
Deltas de ejemplo encontrados: 441.922 → 4.422.780 (ratio ×10), 442 → 451.089
(ratio ×1000), y casos de **retroceso** brusco (ej. una carga con km=11.111
metida en medio de una secuencia ~235.000 del mismo vehículo).

Umbral usado: **5.000 km** entre cargas consecutivas (dato del negocio — la
mediana real es 1.098 km, p95 4.348 km; 5.000 km deja pasar los viajes largos
legítimos y corta antes del salto a valores de cientos de miles).

**A diferencia de litros, acá no hay un factor único dominante:** se probó
÷10/÷100/÷1000 contra las anomalías y quedó repartido (6/11/12 casos) con 67%
sin ningún factor limpio — no es un bug sistemático de un solo punto del
pipeline, parece tipeo libre en distintas posiciones. Por eso la corrección se
valida más estricto que litros: se prueba ×10/×100/×1000 (km demasiado bajo) y
÷10/÷100/÷1000 (demasiado alto), y solo se acepta si el resultado da un delta
razonable (0–5.000 km) contra **ambos vecinos físicos** a la vez (no solo uno) —
esa validación cruzada es lo que reemplaza al "factor único" como garantía de
que no se está inventando el valor.

**Detalle importante de implementación:** las cargas ya sospechosas de litros/
importe se siguen usando como vecino físico al construir la cadena de km (su
odómetro puede ser válido aunque su importe no lo sea). Filtrar por `sospechoso`
al elegir vecinos (como hace el dashboard al calcular sus propios km) genera
cascada: cada carga excluida corre el ancla más atrás, y el delta termina
midiendo kilometraje real acumulado de varias cargas seguidas en vez de una
sola, generando falsos positivos masivos (se probó: 534 marcadas sospechosas,
la mayoría huecos reales, no errores de dato). Con adyacencia física quedó en
57.

Resultado en QA: **10 corregidas**, **57 marcadas sospechosas**
(`motivoSospecha = 'km_delta_invalido'`), sobre 2040 cargas con vehículo
evaluadas. Valor original en `kmOriginal`.

---

## Fix del cálculo del dashboard (km recorridos)

Corregir los datos no alcanzó para que el dashboard diera un número creíble:
el cálculo de "km recorridos del período" (`buildAlertasYKmPeriodo` /
`buildEvolucionCostoPorKm` en `combustible.service.ts`) usa la cadena de km
**ya filtrada por `sospechoso: false`** (igual que toda query de reportes) —
y ahí sí aplica el problema de cascada descripto arriba: cuando hay una racha
larga de cargas excluidas de un mismo vehículo, el km recorrido en ese hueco
se sigue sumando completo al bucket de la carga siguiente, mientras que el
gasto de las cargas excluidas de ese mismo hueco no se cuenta — infla el
denominador sin inflar el numerador, y el $/km sale artificialmente bajo.

Fix aplicado: se capea cualquier delta de km individual mayor a
`KM_DELTA_PLAUSIBLE_MAX` (5.000 km, misma constante que usa el script —
extraída a `src/shared/util/combustible-km.constants.ts` para no duplicarla) —
en vez de sumarlo, se descarta ese segmento del cálculo de km recorridos. No
se inventa un valor, simplemente ese tramo queda sin dato confiable de
distancia, igual que ya queda sin dato confiable de gasto.

Impacto verificado (simulando el cálculo real): **julio 2026 pasó de $74/km a
~$563/km**, y el acumulado de los **últimos 3 meses de $62/km a ~$415/km**
(dentro del rango 200-500 esperado por el negocio).

---

## Costo por km — tercera dimensión (un vehículo con litros/importe y km rotos por separado, pero que se combinan)

Investigando un pico puntual de $2.190/km en el gráfico de julio, apareció un
caso que ni el detector de litros/importe ni el de km agarran por separado:
el vehículo **AF626GO** (real, no de prueba) tiene el km roto desde octubre
2025 — pasó de un odómetro real (six dígitos, ~305.000) a una secuencia chica
autoconsistente que sube de a 1 por carga (272, 273, 274… 331, 332…) y se
mantiene así durante 9 meses. Cada delta individual dentro de esa racha es
mínimo (ej. 15 km), así que el detector de fase 2 no lo marca — el problema no
es el delta, es que *toda la escala* del odómetro está mal desde hace meses,
y eso no se ve comparando solo contra el vecino inmediato. Combinado con
algunas cargas de esa racha con `importe` sospechosamente redondo (`$990.000`,
`$100.000`), el precio/litro resultante cae *dentro* del rango $900–3500 (pasa
la fase 1) y el delta de km es chico (pasa la fase 2) — pero el costo
resultante por km ($990.000 / 15km ≈ **$66.000/km**) no tiene sentido.

Se agregó una fase 3 que calcula el costo por km de cada carga puntual
(`importe / delta contra la carga físicamente anterior`) sobre las cargas que
ya pasaron las fases 1 y 2. Se probó contra las cargas limpias: mediana real
$508/km, percentil 95 $856/km, y de ahí un salto directo a cientos de miles —
sin zona gris. Umbral usado: **$3.000/km** (dato del negocio, ~3.5x el
percentil 95 real). Sin corrección posible (es ambiguo si el problema es el
importe o el km) → sospechosa (`motivoSospecha = 'costo_km_invalido'`).

No se persigue el caso general de "vehículo con km roto durante meses" más
allá de esto — encontrar la racha completa (no solo las cargas donde además el
importe da un costo/km absurdo) requeriría comparar contra una ventana mucho
más larga que la carga vecina, y quedó fuera de este alcance.

Resultado en QA: **20 marcadas sospechosas** (`costo_km_invalido`), incluidas
las dos cargas de $990.000 de AF626GO que causaban el pico de julio.

---

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

- **Script corrido en QA — litros/importe (2026-07-15).** 2049 cargas
  procesadas: **402 corregidas** (÷1000) y **732 sospechosas** (96
  `litros_extremo`, 132 `importe_invalido`, 504 `precio_litro_fuera_de_rango`).
- **Script corrido en QA — km (2026-07-16).** 2040 cargas con vehículo
  evaluadas: **10 corregidas** (×/÷ 10/100/1000) y **57 sospechosas**
  (`km_delta_invalido`).
- **Script corrido en QA — costo por km (2026-07-16).** **20 sospechosas**
  (`costo_km_invalido`), sobre las cargas que ya habían pasado fases 1 y 2.
  Verificado contra la base en las tres corridas — coincide exacto con el
  dry-run previo en cada una.
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
- **Cálculo de km recorridos corregido** (ver sección arriba): deltas de km
  implausibles (> 5.000 km, típicamente huecos de cargas excluidas) ya no se
  suman al denominador de costo/km.
- Los cambios de `combustible.service.ts` y del frontend del dashboard
  (paneles, gráfico, tarjetas) están commiteados/aplicados localmente pero
  **todavía no pusheados/mergeados** — ver pendientes.

---

## Pendiente

1. **Correr el script en producción** (ambas fases: litros/importe y km). Solo
   se ejecutó en QA hasta ahora. Recomendado ensayar antes contra un branch
   temporal de Neon clonado de producción.
2. **Pushear/mergear los cambios pendientes** de `combustible.service.ts` y del
   frontend del dashboard de combustible — commiteados/aplicados en local, sin
   subir.
3. **Definir el contador de "excluidas" en el dashboard** (ver nota de arriba) —
   sin esto, un usuario puede ver un promedio calculado sobre una fracción chica
   de las cargas del período (hasta ~70-80% excluido en meses recientes) sin
   ninguna señal visual de que faltan datos.
4. **La causa de origen (carga manual) sigue sin resolverse** y, según el
   diagnóstico, empeorando mes a mes (68–79% de tasa de error en abr–jul 2026).
   Cuanto más se posterga, más cargas nuevas van a necesitar este mismo
   tratamiento — vale la pena revisarlo como prioridad aparte, no solo como
   limpieza histórica.
5. **Vehículo AF626GO con km roto desde octubre 2025** (ver sección "Costo por
   km" arriba) — la fase 3 solo agarra las cargas de esa racha donde además el
   importe da un costo/km absurdo (20 casos). El resto de la racha (cargas con
   importe "normal" pero km igual en la escala rota) queda sin detectar y sin
   marcar. Si se confirma que el odómetro de ese vehículo estuvo mal cargado
   todo ese período, conviene revisarlo a mano — no es algo que un umbral
   automático pueda resolver con confianza sin comparar contra una ventana
   mucho más larga que la carga vecina.

## Campos agregados a `CargaCombustible` (Prisma)

```prisma
sospechoso      Boolean @default(false)
motivoSospecha  String? // litros_extremo | importe_invalido | precio_litro_fuera_de_rango | km_delta_invalido | costo_km_invalido
litrosOriginal  Float?  // valor previo a la corrección automática de litros (÷1000), null si nunca se corrigió
kmOriginal      Int?    // valor previo a la corrección automática de km (×/÷ 10/100/1000), null si nunca se corrigió
```

Aplicado en QA vía migraciones `20260715184915_carga_combustible_flag_sospechoso`
y `20260716182342_carga_combustible_km_original`.

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

El script corre las tres fases (litros/importe, km y costo por km) en una sola
invocación. Es **idempotente** en las tres: fase 1 solo procesa cargas con
`sospechoso = false` y `litrosOriginal = null`; fases 2 y 3 solo evalúan
cargas con `kmOriginal = null` que no hayan quedado sospechosas antes (de
ninguna fase). Correr de nuevo no repite trabajo ni pisa correcciones ya
aplicadas — sirve tanto para el pase histórico como para pasadas periódicas
mientras la causa de origen (carga manual) siga activa.

Flujo recomendado: correr `--dry-run` y `fix:combustible` primero en QA, validar
el resumen y una muestra de las cargas corregidas, y recién después repetir en
producción (opcionalmente ensayando antes contra un branch temporal de Neon
clonado de producción, como se hizo para la migración de schema).
