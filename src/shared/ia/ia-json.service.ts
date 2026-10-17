import { Injectable } from "@nestjs/common";

export type IaProveedor = "Gemini" | "Groq";

export interface IaJsonRespuesta {
  /** JSON crudo devuelto por el modelo (el que llama lo parsea y valida). */
  text: string;
  /** Proveedor que efectivamente respondió (puede no ser el principal, si hubo fallback). */
  proveedor: IaProveedor;
  /** Modelo puntual usado dentro de ese proveedor. */
  modelo: string;
}

export class IaNoConfiguradaError extends Error {
  constructor() {
    super("La IA no está configurada en el servidor (falta GEMINI_API_KEY o GROQ_API_KEY).");
  }
}

/**
 * Cliente de IA que pide una respuesta en JSON. Compartido (core y módulos).
 *
 * Gemini es el proveedor principal (GEMINI_API_KEY). El modelo gratuito
 * suele devolver 503/429 por demanda alta — si eso pasa (incluso después de
 * reintentar), y hay una GROQ_API_KEY configurada, se cae a Groq como
 * respaldo, en vez de fallarle al usuario.
 */
@Injectable()
export class IaJsonService {
  private readonly geminiApiKey = process.env.GEMINI_API_KEY;
  private readonly geminiModel =
    process.env.GEMINI_MODEL || "gemini-3.7-flash";
  private readonly groqApiKey = process.env.GROQ_API_KEY;
  // "llama-3.3-70b-versatile" se dio de baja en Groq el 16/8/26 — reemplazo
  // recomendado por Groq mismo, configurable por env para no repetir esto.
  private readonly groqModel =
    process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  get configurada(): boolean {
    return Boolean(this.geminiApiKey || this.groqApiKey);
  }

  /**
   * @param schemaGemini `responseSchema` de Gemini (formato OpenAPI de Google).
   * @param formatoGroq Descripción de la forma exacta del JSON, para Groq (que no
   *   recibe schema): se agrega al prompt.
   * @throws IaNoConfiguradaError si no hay ninguna API key.
   * @throws Error con el detalle de cada proveedor si ninguno respondió.
   */
  async generarJson(
    prompt: string,
    schemaGemini: Record<string, unknown>,
    formatoGroq: string,
  ): Promise<IaJsonRespuesta> {
    if (!this.configurada) throw new IaNoConfiguradaError();

    const errores: string[] = [];

    if (this.geminiApiKey) {
      try {
        const text = await this.llamarGemini(prompt, schemaGemini);
        return { text, proveedor: "Gemini", modelo: this.geminiModel };
      } catch (e) {
        errores.push(e instanceof Error ? e.message : "Error de Gemini.");
      }
    }

    if (this.groqApiKey) {
      try {
        const text = await this.llamarGroq(prompt, formatoGroq);
        return { text, proveedor: "Groq", modelo: this.groqModel };
      } catch (e) {
        errores.push(e instanceof Error ? e.message : "Error de Groq.");
      }
    }

    throw new Error(errores.join(" · "));
  }

  private async llamarGemini(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
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
    if (!text) throw new Error("Gemini no devolvió ninguna respuesta.");
    return text;
  }

  private async llamarGroq(prompt: string, formato: string): Promise<string> {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const promptConFormato = `${prompt}

Respondé ÚNICAMENTE con un JSON válido (sin texto adicional, sin markdown) con esta forma exacta:
${formato}`;
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
    if (!text) throw new Error("Groq no devolvió ninguna respuesta.");
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
}
