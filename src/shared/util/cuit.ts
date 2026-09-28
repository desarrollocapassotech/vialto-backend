/** "30-71234567-8" → "30712345678" (solo dígitos). */
export function normalizarCuit(cuit: string): string {
  return cuit.replace(/\D/g, '');
}

/**
 * Valida el dígito verificador (módulo 11) de un CUIT/CUIL de 11 dígitos.
 * Un resultado de 10 nunca es válido: ARCA cambia el prefijo (23/33) en ese caso.
 */
export function cuitDigitoVerificadorValido(cuit: string): boolean {
  const d = normalizarCuit(cuit);
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto;
  return dv !== 10 && dv === Number(d[10]);
}
