import { Injectable, Logger } from '@nestjs/common';
import { IaJsonService } from '../../shared/ia/ia-json.service';
import { pluralizarCastellano } from '../../shared/util/producto-label.util';

const SCHEMA_PLURAL = {
  type: 'OBJECT',
  properties: { plural: { type: 'STRING' } },
  required: ['plural'],
};

/**
 * Plural del label de "Producto" de un tenant (ej. "Grano" → "Granos").
 * Lo pide a la IA; si no está configurada o falla, usa la regla de
 * `pluralizarCastellano`. Nunca tira: el guardado del tenant no depende de la IA.
 */
@Injectable()
export class ProductoLabelPluralService {
  private readonly logger = new Logger(ProductoLabelPluralService.name);

  constructor(private readonly ia: IaJsonService) {}

  async generar(singular: string): Promise<string> {
    const respaldo = pluralizarCastellano(singular);
    if (!this.ia.configurada) return respaldo;
    try {
      const { text } = await this.ia.generarJson(
        `Dame el plural en español (Argentina) de la siguiente palabra o frase, que se usa como nombre de una entidad en un sistema de logística de cargas: "${singular}".
Reglas:
- Respetá exactamente las mayúsculas/minúsculas del original.
- Si es una frase, pluralizá solo lo que corresponda (ej. "Tipo de carga" → "Tipos de carga").
- Corregí acentos si el plural los pierde o los gana (ej. "Camión" → "Camiones", "Origen" → "Orígenes").`,
        SCHEMA_PLURAL,
        '{"plural": "<plural>"}',
      );
      const plural = (JSON.parse(text) as { plural?: unknown }).plural;
      if (typeof plural === 'string' && plural.trim() && plural.trim().length <= 80) {
        return plural.trim();
      }
    } catch (e) {
      this.logger.warn(
        `No se pudo generar con IA el plural de "${singular}": ${e instanceof Error ? e.message : e}`,
      );
    }
    return respaldo;
  }
}
