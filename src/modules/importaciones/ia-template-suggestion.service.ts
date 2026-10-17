import { BadRequestException, Injectable } from "@nestjs/common";
import type { CatalogoColumn } from "./template-catalogo";
import { IaJsonService, type IaProveedor } from "../../shared/ia/ia-json.service";

export interface SugerenciaTemplate {
  /** Proveedor que efectivamente respondió (puede no ser el principal, si hubo fallback). */
  proveedor: IaProveedor;
  /** Modelo puntual usado dentro de ese proveedor. */
  modelo: string;
  /** Hoja del Excel que la IA identificó como la correcta para este módulo. */
  sheet: string;
  /** Fila (1-based) donde la IA identificó los encabezados reales. */
  headerRow: number;
  columnas: Array<{ field: string; excelHeader: string }>;
  /** Encabezados del Excel que la IA no pudo asociar a ningún campo del sistema. */
  headersNoUsados: string[];
}

interface HojaMuestra {
  nombre: string;
  filas: unknown[][];
}

const JSON_SCHEMA_GEMINI = {
  type: "OBJECT",
  properties: {
    hoja: { type: "STRING" },
    filaEncabezados: { type: "INTEGER" },
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
  required: ["hoja", "filaEncabezados", "mapeos"],
};

/**
 * Propone un mapeo de encabezados de Excel → campos del sistema usando IA.
 * Es solo una SUGERENCIA: nunca guarda nada, el superadmin la revisa y
 * corrige en el mismo formulario antes de guardar (igual que si la hubiera
 * completado a mano). Proveedores y reintentos: ver `IaJsonService`.
 */
@Injectable()
export class IaTemplateSuggestionService {
  constructor(private readonly ia: IaJsonService) {}

  async sugerir(
    catalogo: CatalogoColumn[],
    hojas: HojaMuestra[],
  ): Promise<SugerenciaTemplate> {
    if (!this.ia.configurada) {
      throw new BadRequestException(
        "La sugerencia con IA no está configurada en el servidor (falta GEMINI_API_KEY o GROQ_API_KEY).",
      );
    }

    const prompt = this.buildPrompt(catalogo, hojas);
    let text: string;
    let proveedor: IaProveedor;
    let modelo: string;
    try {
      ({ text, proveedor, modelo } = await this.ia.generarJson(
        prompt,
        JSON_SCHEMA_GEMINI,
        `{"hoja": "<nombre de hoja>", "filaEncabezados": <número>, "mapeos": [{"field": "<campo>", "excelHeader": "<encabezado o vacío>"}]}`,
      ));
    } catch (e) {
      throw new BadRequestException(
        `No se pudo generar la sugerencia con IA. ${e instanceof Error ? e.message : ""}`,
      );
    }

    let parsed: {
      hoja?: string;
      filaEncabezados?: number;
      mapeos?: { field?: string; excelHeader?: string }[];
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BadRequestException(
        "La IA devolvió una respuesta que no se pudo interpretar.",
      );
    }

    return this.normalizar(parsed, catalogo, hojas, proveedor, modelo);
  }

  private buildPrompt(catalogo: CatalogoColumn[], hojas: HojaMuestra[]): string {
    const campos = catalogo
      .map(
        (c) =>
          `- ${c.field} ("${c.campoLabel}", tipo ${c.type}${c.systemRequired ? ", obligatorio" : ""})`,
      )
      .join("\n");

    const hojasTexto = hojas
      .map((hoja) => {
        const filasTexto = hoja.filas
          .map((fila, i) => {
            const celdas = (fila as unknown[])
              .map((c) => this.formatCell(c))
              .join(" | ");
            return `  Fila ${i + 1}: ${celdas}`;
          })
          .join("\n");
        return `Hoja "${hoja.nombre}":\n${filasTexto || "  (vacía)"}`;
      })
      .join("\n\n");

    return `Sos un asistente que analiza un archivo Excel de logística de carga (Argentina/Mercosur) para configurar una importación masiva.

Campos del sistema a completar:
${campos}

El archivo tiene una o más hojas. Te muestro las primeras filas de cada una, tal cual vienen (pueden incluir filas de título, filas vacías, etc. antes de la fila real de encabezados):

${hojasTexto}

Tarea:
1. Elegí la hoja que corresponde a estos campos (probablemente la que tenga encabezados semánticamente parecidos a los campos del sistema listados).
2. Dentro de esa hoja, identificá el número de fila (1-based, tal como está numerada arriba) que contiene los encabezados reales de columna — no necesariamente es la fila 1, puede haber títulos o filas vacías antes.
3. Para cada campo del sistema, elegí el encabezado de esa fila que mejor le corresponda semánticamente — los encabezados suelen venir abreviados o en jerga del rubro (ej. "CRT" = Carta de Porte / referencia de la carga, "FLETERO" = transportista). Usá también los valores de las filas siguientes como pista (fechas, montos, nombres de empresas, patentes, etc.).

Reglas:
- "hoja" tiene que ser EXACTAMENTE uno de los nombres de hoja listados arriba.
- "filaEncabezados" es el número de fila (1-based) dentro de esa hoja, tal como está numerada en el texto de arriba.
- El "excelHeader" que devuelvas para cada campo tiene que ser EXACTAMENTE uno de los valores de esa fila de encabezados, sin inventar ni modificar el texto.
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
    parsed: {
      hoja?: string;
      filaEncabezados?: number;
      mapeos?: { field?: string; excelHeader?: string }[];
    },
    catalogo: CatalogoColumn[],
    hojas: HojaMuestra[],
    proveedor: IaProveedor,
    modelo: string,
  ): SugerenciaTemplate {
    // Defensa contra alucinaciones: la hoja tiene que ser una que
    // realmente exista en el archivo — si no, nos quedamos con la primera.
    const hojaElegida =
      hojas.find(
        (h) => h.nombre.toLowerCase() === parsed.hoja?.trim().toLowerCase(),
      ) ?? hojas[0];

    // Idem la fila de encabezados: tiene que caer dentro de lo que le
    // mostramos a la IA, si no default a la fila 1.
    const filaEncabezados =
      parsed.filaEncabezados &&
      parsed.filaEncabezados >= 1 &&
      parsed.filaEncabezados <= hojaElegida.filas.length
        ? Math.trunc(parsed.filaEncabezados)
        : 1;

    const headers = (
      (hojaElegida.filas[filaEncabezados - 1] as unknown[]) ?? []
    )
      .map((h) => (h != null ? String(h).trim() : ""))
      .filter((h) => h !== "");

    const camposValidos = new Set(catalogo.map((c) => c.field));
    const headersPorLower = new Map(headers.map((h) => [h.toLowerCase(), h]));

    const columnas: Array<{ field: string; excelHeader: string }> = [];
    const usados = new Set<string>();

    for (const m of parsed.mapeos ?? []) {
      const field = m.field?.trim();
      const headerSugerido = m.excelHeader?.trim();
      if (!field || !camposValidos.has(field)) continue;

      // Defensa contra alucinaciones: solo aceptamos encabezados que
      // realmente existen en la fila elegida, tal como vinieron.
      const headerReal = headerSugerido
        ? headersPorLower.get(headerSugerido.toLowerCase())
        : undefined;

      columnas.push({ field, excelHeader: headerReal ?? "" });
      if (headerReal) usados.add(headerReal.toLowerCase());
    }

    const headersNoUsados = headers.filter(
      (h) => !usados.has(h.toLowerCase()),
    );

    return {
      proveedor,
      modelo,
      sheet: hojaElegida.nombre,
      headerRow: filaEncabezados,
      columnas,
      headersNoUsados,
    };
  }
}
