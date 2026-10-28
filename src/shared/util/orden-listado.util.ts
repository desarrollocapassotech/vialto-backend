/**
 * Orden de grillas por columna (click en el título), en memoria. Espejo de
 * `lib/ordenListado.ts` del front: si cambia el criterio, cambiarlo en los dos lados.
 */

export type OrdenDir = "asc" | "desc";
export type ValorOrden = string | number | null | undefined;

const collatorEs = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function vacio(v: ValorOrden): boolean {
  if (v == null) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  return !v.trim();
}

/**
 * Texto sin mayúsculas ni acentos ("Álvarez" junto a "Alvarez") y con números como
 * números ("CP 2" antes que "CP 10"); números como números. Vacíos siempre al final.
 */
export function compararValorOrden(
  a: ValorOrden,
  b: ValorOrden,
  dir: OrdenDir,
  tieBreak: () => number = () => 0,
): number {
  const va = vacio(a);
  const vb = vacio(b);
  if (va && vb) return tieBreak();
  if (va) return 1;
  if (vb) return -1;
  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collatorEs.compare(String(a).trim(), String(b).trim());
  if (cmp === 0) return tieBreak();
  return dir === "asc" ? cmp : -cmp;
}

/** Ordena por varias claves en orden (la 2da desempata la 1ra, etc.), y al final por id. */
export function ordenarPorClaves<T extends { id: string }>(
  filas: readonly T[],
  claves: (fila: T) => ValorOrden[],
  dir: OrdenDir,
): T[] {
  const porId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const conClaves = filas.map((fila) => ({ fila, claves: claves(fila) }));
  conClaves.sort((a, b) => {
    const comparar = (i: number): number =>
      i >= a.claves.length
        ? porId(a.fila.id, b.fila.id)
        : compararValorOrden(a.claves[i], b.claves[i], dir, () => comparar(i + 1));
    return comparar(0);
  });
  return conClaves.map((x) => x.fila);
}
