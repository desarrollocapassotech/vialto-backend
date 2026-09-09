/**
 * Detección/corrección de litros e importe incoherentes en una carga de combustible
 * (fase 1, por fila — no depende de otras cargas del vehículo; ver
 * docs/combustible-correccion-cargas-historicas.md). Fuente única de verdad: la usa
 * tanto el alta en vivo (`CombustibleService.create`/`createByChofer`) como el script
 * histórico (`scripts/fix-combustible-cargas-sospechosas.ts`), para que ambos apliquen
 * exactamente el mismo criterio sin duplicar las reglas de negocio.
 */

export const LITROS_EXTREMO_UMBRAL = 100_000;
export const FACTOR_CORRECCION_LITROS = 1000;
export const LITROS_PLAUSIBLE_MIN = 5;
export const LITROS_PLAUSIBLE_MAX = 1000;
export const PRECIO_LITRO_MIN = 900;
export const PRECIO_LITRO_MAX = 3500;

export type MotivoSospechaFase1 =
  | "litros_extremo"
  | "importe_invalido"
  | "precio_litro_fuera_de_rango";

export interface EvaluacionFase1 {
  litros: number;
  litrosOriginal: number | null;
  sospechoso: boolean;
  motivoSospecha: MotivoSospechaFase1 | null;
}

function enRango(valor: number, min: number, max: number): boolean {
  return valor >= min && valor <= max;
}

/**
 * Evalúa litros/importe de una carga y devuelve el `litros` a persistir (corregido
 * ÷1000 si el resultado cae en un rango físico plausible y el precio/litro resultante
 * también), o la marca de sospechosa si no hay corrección posible. Nunca lanza
 * excepciones ni bloquea el alta — mismo criterio "detectar y marcar, corregir solo si
 * hay un único factor limpio" que ya corre en el script histórico.
 */
export function evaluarLitrosImporteFase1(
  litros: number,
  importe: number,
): EvaluacionFase1 {
  if (litros >= LITROS_EXTREMO_UMBRAL) {
    const litrosCorregidos = litros / FACTOR_CORRECCION_LITROS;
    const precioCorregido = importe > 0 ? importe / litrosCorregidos : 0;

    if (
      enRango(litrosCorregidos, LITROS_PLAUSIBLE_MIN, LITROS_PLAUSIBLE_MAX) &&
      enRango(precioCorregido, PRECIO_LITRO_MIN, PRECIO_LITRO_MAX)
    ) {
      return {
        litros: litrosCorregidos,
        litrosOriginal: litros,
        sospechoso: false,
        motivoSospecha: null,
      };
    }
    return {
      litros,
      litrosOriginal: null,
      sospechoso: true,
      motivoSospecha: "litros_extremo",
    };
  }

  if (importe <= 0) {
    return {
      litros,
      litrosOriginal: null,
      sospechoso: true,
      motivoSospecha: "importe_invalido",
    };
  }

  const precioLitro = importe / litros;
  if (!enRango(precioLitro, PRECIO_LITRO_MIN, PRECIO_LITRO_MAX)) {
    return {
      litros,
      litrosOriginal: null,
      sospechoso: true,
      motivoSospecha: "precio_litro_fuera_de_rango",
    };
  }

  return { litros, litrosOriginal: null, sospechoso: false, motivoSospecha: null };
}
