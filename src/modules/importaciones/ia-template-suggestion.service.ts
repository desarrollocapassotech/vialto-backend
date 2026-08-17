import { BadRequestException, Injectable } from "@nestjs/common";
import type { CatalogoColumn } from "./template-catalogo";

export interface SugerenciaTemplate {
  /** Proveedor que efectivamente respondió (puede no ser el principal, si hubo fallback). */
  proveedor: "Gemini" | "Groq";
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
 * completado a mano).
 *
 * Gemini es el proveedor principal (GEMINI_API_KEY). El modelo gratuito
 * suele devolver 503/429 por demanda alta — si eso pasa (incluso después de
 * reintentar), y hay una GROQ_API_KEY configurada, se cae a Groq (Llama,
 * también gratis) como respaldo, en vez de fallarle al usuario.
 */
@Injectable()
export class IaTemplateSuggestionService {
  private readonly geminiApiKey = process.env.GEMINI_API_KEY;
  private readonly geminiModel =
    process.env.GEMINI_MODEL || "gemini-3.7-flash";
  private readonly groqApiKey = process.env.GROQ_API_KEY;
  // "llama-3.3-70b-versatile" se dio de baja en Groq el 16/8/26 — reemplazo
  // recomendado por Groq mismo, configurable por env para no repetir esto.
  private readonly groqModel =
    process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  async sugerir(
    catalogo: CatalogoColumn[],
    hojas: HojaMuestra[],
  ): Promise<SugerenciaTemplate> {
    if (!this.geminiApiKey && !this.groqApiKey) {
      throw new BadRequestException(
        "La sugerencia con IA no está configurada en el servidor (falta GEMINI_API_KEY o GROQ_API_KEY).",
      );
    }

    const prompt = this.buildPrompt(catalogo, hojas);
    const errores: string[] = [];
    let text: string | null = null;
    let proveedor: "Gemini" | "Groq" | null = null;
    let modelo: string | null = null;

    if (this.geminiApiKey) {
      try {
        text = await this.llamarGemini(prompt);
        proveedor = "Gemini";
        modelo = this.geminiModel;
      } catch (e) {
        errores.push(e instanceof Error ? e.message : "Error de Gemini.");
      }
    }

    if (!text && this.groqApiKey) {
      try {
        text = await this.llamarGroq(prompt);
        proveedor = "Groq";
        modelo = this.groqModel;
      } catch (e) {
        errores.push(e instanceof Error ? e.message : "Error de Groq.");
      }
    }

    if (!text || !proveedor || !modelo) {
      throw new BadRequestException(
        `No se pudo generar la sugerencia con IA. ${errores.join(" · ")}`,
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

  private async llamarGemini(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: JSON_SCHEMA_GEMINI,
      },
    });

    const res = await this.fetchConReintentos(
      "Gemini",
      url,
      { "Content-Type": "application/json" },
      body,
    );
    if (!res.ok) {
      throw new Error(await this.mensajeError("Gemini", res));
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini no devolvió ninguna sugerencia.");
    return text;
  }

  private async llamarGroq(prompt: string): Promise<string> {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const promptConFormato = `${prompt}

Respondé ÚNICAMENTE con un JSON válido (sin texto adicional, sin markdown) con esta forma exacta:
{"hoja": "<nombre de hoja>", "filaEncabezados": <número>, "mapeos": [{"field": "<campo>", "excelHeader": "<encabezado o vacío>"}]}`;
    const body = JSON.stringify({
      model: this.groqModel,
      messages: [{ role: "user", content: promptConFormato }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const res = await this.fetchConReintentos(
      "Groq",
      url,
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.groqApiKey}`,
      },
      body,
    );
    if (!res.ok) {
      throw new Error(await this.mensajeError("Groq", res));
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq no devolvió ninguna sugerencia.");
    return text;
  }

  private async mensajeError(proveedor: string, res: Response): Promise<string> {
    if (res.status === 503 || res.status === 429) {
      return `${proveedor} está saturado en este momento.`;
    }
    const body = await res.text().catch(() => "");
    return `${proveedor} devolvió un error (${res.status}). ${body.slice(0, 200)}`;
  }

  /**
   * Los modelos gratuitos devuelven 503 (UNAVAILABLE) o 429 (rate limit)
   * con bastante frecuencia por demanda alta — son errores transitorios, no
   * de nuestro request, así que reintentamos con backoff antes de
   * rendirnos (y eventualmente pasar al proveedor de respaldo).
   */
  private async fetchConReintentos(
    proveedor: string,
    url: string,
    headers: Record<string, string>,
    body: string,
    intentos = 3,
  ): Promise<Response> {
    let ultimaRespuesta: Response | undefined;
    for (let intento = 0; intento < intentos; intento++) {
      if (intento > 0) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (intento - 1)));
      }
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        if (res.ok || (res.status !== 503 && res.status !== 429)) {
          return res;
        }
        ultimaRespuesta = res;
      } catch {
        if (intento === intentos - 1) {
          throw new Error(`No se pudo conectar con ${proveedor}.`);
        }
      }
    }
    // Se agotaron los reintentos y el último intento fue 503/429.
    return ultimaRespuesta!;
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
    proveedor: "Gemini" | "Groq",
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
