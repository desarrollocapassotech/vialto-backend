/**
 * Label personalizado de "Producto" por tenant (`Tenant.productoLabel` /
 * `productoLabelPlural`, ej. "Grano" / "Granos"). Aplica a todo el sistema
 * salvo el módulo Stock y el término fiscal "Líquido Producto" de ARCA.
 * Espejo de `lib/productoLabel.ts` del frontend.
 */
export interface ProductoLabels {
  singular: string;
  plural: string;
}

export const PRODUCTO_LABELS_DEFAULT: ProductoLabels = {
  singular: 'Producto',
  plural: 'Productos',
};

export function productoLabels(
  tenant: { productoLabel?: string | null; productoLabelPlural?: string | null } | null | undefined,
): ProductoLabels {
  const singular = tenant?.productoLabel?.trim();
  if (!singular) return PRODUCTO_LABELS_DEFAULT;
  return {
    singular,
    plural: tenant?.productoLabelPlural?.trim() || pluralizarCastellano(singular),
  };
}

/** Labels del tenant leídos de la base (para mensajes armados fuera de un PDF/listado). */
export async function productoLabelsDeTenant(
  db: {
    tenant: {
      findUnique(args: {
        where: { clerkOrgId: string };
        select: { productoLabel: true; productoLabelPlural: true };
      }): Promise<{ productoLabel: string | null; productoLabelPlural: string | null } | null>;
    };
  },
  tenantId: string,
): Promise<ProductoLabels> {
  return productoLabels(
    await db.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { productoLabel: true, productoLabelPlural: true },
    }),
  );
}

/**
 * Label para usar en medio de una frase ("Cantidad de grano"): primera letra en
 * minúscula, salvo siglas en mayúscula ("CPE" queda igual).
 */
export function labelEnFrase(label: string): string {
  const primera = label.split(/\s+/)[0] ?? '';
  if (primera.length > 1 && primera === primera.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Plural por regla (respaldo cuando la IA no responde): vocal → +s,
 * -z → -ces, consonante → +es. Solo pluraliza la primera palabra si hay más de
 * una ("Tipo de carga" → "Tipos de carga"). No cubre acentos que se pierden
 * ("Camión" → "Camiones"): para eso está la IA y el campo editable.
 */
export function pluralizarCastellano(texto: string): string {
  const t = texto.trim();
  if (!t) return t;
  const [primera, ...resto] = t.split(/\s+/);
  const sufijoResto = resto.length ? ` ${resto.join(' ')}` : '';
  const mayus = primera === primera.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(primera);
  const ajustar = (s: string) => (mayus ? s.toUpperCase() : s);
  const ultima = primera.slice(-1).toLowerCase();
  let plural: string;
  if (/[aeiouáéó]/.test(ultima)) plural = primera + ajustar('s');
  else if (ultima === 'z') plural = primera.slice(0, -1) + ajustar('ces');
  else if (/[sx]/.test(ultima)) plural = primera;
  else plural = primera + ajustar('es');
  return plural + sufijoResto;
}
