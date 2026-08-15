import { BadRequestException, Injectable } from "@nestjs/common";
import type { CatalogoColumn } from "./template-catalogo";

export interface SugerenciaTemplate {
  columnas: Array<{ field: string; excelHeader: string }>;
  /** Encabezados del Excel que la IA no pudo asociar a ningún campo del sistema. */
  headersNoUsados: string[];
}

/**
 * Propone un mapeo de encabezados de Excel → campos del sistema usando la
 * API gratuita de Gemini. Es solo una SUGERENCIA: nunca guarda nada, el
 * superadmin la revisa y corrige en el mismo formulario antes de guardar
 * (igual que si la hubiera completado a mano).
 */
@Injectable()
export class IaTemplateSuggestionService {
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly model = process.env.GEMINI_MODEL || "gemini-3.7-flash";

  async sugerir(
    catalogo: CatalogoColumn[],
    headers: string[],
    sampleRows: unknown[][],
  ): Promise<SugerenciaTemplate> {
    if (!this.apiKey) {
      throw new BadRequestException(
        "La sugerencia con IA no está configurada en el servidor (falta GEMINI_API_KEY).",
      );
    }

    const prompt = this.buildPrompt(catalogo, headers, sampleRows);

    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  mapeos: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        field: { type: "STRING" },
                        excelHeader: { type: "STRING" },
                      },
                      required: ["field", "excelHeader"],
                    },
                  },
                },
                required: ["mapeos"],
              },
            },
          }),
        },
      );
    } catch {
      throw new BadRequestException(
        "No se pudo conectar con el servicio de IA. Probá de nuevo.",
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BadRequestException(
        `El servicio de IA devolvió un error (${res.status}). ${body.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new BadRequestException("La IA no devolvió ninguna sugerencia.");
    }

    let parsed: { mapeos?: { field?: string; excelHeader?: string }[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BadRequestException(
        "La IA devolvió una respuesta que no se pudo interpretar.",
      );
    }

    return this.normalizar(parsed, catalogo, headers);
  }

  private buildPrompt(
    catalogo: CatalogoColumn[],
    headers: string[],
    sampleRows: unknown[][],
  ): string {
    const campos = catalogo
      .map(
        (c) =>
          `- ${c.field} ("${c.campoLabel}", tipo ${c.type}${c.systemRequired ? ", obligatorio" : ""})`,
      )
      .join("\n");

    const ejemplos = headers
      .map((h, i) => {
        const valores = sampleRows
          .map((row) => this.formatCell((row as unknown[])[i]))
          .join(" | ");
        return `- "${h}": ${valores || "(sin datos de ejemplo)"}`;
      })
      .join("\n");

    return `Sos un asistente que mapea columnas de un Excel de logística de carga (Argentina/Mercosur) a campos de un sistema.

Campos del sistema a completar:
${campos}

Encabezados reales del Excel, con valores de ejemplo de las primeras filas:
${ejemplos}

Para cada campo del sistema de la lista, elegí el encabezado del Excel que mejor le corresponda semánticamente — los encabezados suelen venir abreviados o en jerga del rubro (ej. "CRT" = Carta de Porte / referencia de la carga, "FLETERO" = transportista). Usá también los valores de ejemplo como pista (fechas, montos, nombres de empresas, patentes, etc.).

Reglas:
- El "excelHeader" que devuelvas para cada campo tiene que ser EXACTAMENTE uno de los encabezados listados arriba, sin inventar ni modificar el texto.
- Si ningún encabezado corresponde bien a un campo, devolvé excelHeader como cadena vacía "" para ese campo.
- Un mismo encabezado del Excel no debería usarse para más de un campo.
- Devolvé un mapeo para TODOS los campos del sistema listados, en el mismo orden.`;
  }

  private formatCell(value: unknown): string {
    if (value == null || String(value).trim() === "") return "(vacío)";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).trim();
  }

  private normalizar(
    parsed: { mapeos?: { field?: string; excelHeader?: string }[] },
    catalogo: CatalogoColumn[],
    headers: string[],
  ): SugerenciaTemplate {
    const camposValidos = new Set(catalogo.map((c) => c.field));
    const headersPorLower = new Map(headers.map((h) => [h.toLowerCase(), h]));

    const columnas: Array<{ field: string; excelHeader: string }> = [];
    const usados = new Set<string>();

    for (const m of parsed.mapeos ?? []) {
      const field = m.field?.trim();
      const headerSugerido = m.excelHeader?.trim();
      if (!field || !camposValidos.has(field)) continue;

      // Defensa contra alucinaciones: solo aceptamos encabezados que
      // realmente existen en el archivo, tal como vinieron.
      const headerReal = headerSugerido
        ? headersPorLower.get(headerSugerido.toLowerCase())
        : undefined;

      columnas.push({ field, excelHeader: headerReal ?? "" });
      if (headerReal) usados.add(headerReal.toLowerCase());
    }

    const headersNoUsados = headers.filter(
      (h) => !usados.has(h.toLowerCase()),
    );

    return { columnas, headersNoUsados };
  }
}
