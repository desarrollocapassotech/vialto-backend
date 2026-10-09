import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Afip = require('@afipsdk/afip.js');
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';
import { PadronConsulta } from './padron.types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope diario de consultas reales a ARCA por tenant (los hits de caché no cuentan). */
const MAX_CONSULTAS_DIARIAS_POR_TENANT = 100;

const toArray = <T>(v: T | T[] | null | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

const ENTIDADES_HTML: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * ARCA devuelve algunos textos con entidades HTML (ej. "PE&#209;A" en vez de "PEÑA").
 * Decodifica numéricas (&#209; / &#xD1;) y las nombradas comunes.
 */
function decodificarEntidades<T extends string | null | undefined>(texto: T): T {
  if (typeof texto !== 'string' || !texto.includes('&')) return texto;
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTIDADES_HTML[ent.toLowerCase()] ?? match;
  }) as T;
}

/** Mismo criterio que normalizePem de liquidaciones-arca: tolera "\n" literales y CRLF. */
function normalizePem(pem: string): string {
  return pem.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + '\n';
}

/**
 * Consulta el padrón de ARCA (ws_sr_constancia_inscripcion) con el certificado
 * de plataforma (PADRON_*), no con el del tenant: sirve para cualquier tenant,
 * tenga o no contratado un módulo ARCA.
 */
@Injectable()
export class PadronService {
  private readonly logger = new Logger(PadronService.name);
  private readonly cache = new Map<string, { data: PadronConsulta; expiresAt: number }>();
  private readonly consultasPorTenant = new Map<string, { dia: string; cantidad: number }>();
  private afip: Afip | null = null;

  async consultar(cuitRaw: string, rateKey: string): Promise<PadronConsulta> {
    const cuit = normalizarCuit(cuitRaw);
    if (cuit.length !== 11) {
      throw new BadRequestException('El CUIT/CUIL debe tener 11 dígitos.');
    }
    if (!cuitDigitoVerificadorValido(cuit)) {
      throw new BadRequestException('El CUIT/CUIL no es válido (dígito verificador incorrecto).');
    }

    const cached = this.cache.get(cuit);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    this.registrarConsulta(rateKey);

    let persona: Record<string, any> | null;
    try {
      persona = await this.getClient().RegisterInscriptionProof.getTaxpayerDetails(Number(cuit));
    } catch (err) {
      const detalle = (err as { data?: unknown })?.data ?? (err as Error)?.message ?? err;
      this.logger.error(
        `Padrón ARCA falló para CUIT ${cuit}: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo consultar ARCA en este momento. Podés completar los datos a mano.',
      );
    }

    const data = this.mapPersona(cuit, persona);
    this.cache.set(cuit, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  private getClient(): Afip {
    if (this.afip) return this.afip;
    const { PADRON_AFIP_SDK_API_KEY, PADRON_CUIT, PADRON_CERT, PADRON_KEY } = process.env;
    if (!PADRON_AFIP_SDK_API_KEY || !PADRON_CUIT || !PADRON_CERT || !PADRON_KEY) {
      throw new ServiceUnavailableException(
        'La validación con ARCA no está configurada en el servidor.',
      );
    }
    this.afip = new Afip({
      CUIT: Number(normalizarCuit(PADRON_CUIT)),
      access_token: PADRON_AFIP_SDK_API_KEY,
      production: true,
      cert: normalizePem(PADRON_CERT),
      key: normalizePem(PADRON_KEY),
    });
    return this.afip;
  }

  private registrarConsulta(rateKey: string): void {
    const dia = new Date().toISOString().slice(0, 10);
    const actual = this.consultasPorTenant.get(rateKey);
    const cantidad = actual?.dia === dia ? actual.cantidad : 0;
    if (cantidad >= MAX_CONSULTAS_DIARIAS_POR_TENANT) {
      throw new HttpException(
        'Se alcanzó el límite diario de consultas a ARCA. Podés completar los datos a mano.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.consultasPorTenant.set(rateKey, { dia, cantidad: cantidad + 1 });
  }

  private mapPersona(cuit: string, persona: Record<string, any> | null): PadronConsulta {
    if (!persona) {
      return {
        cuit,
        estado: 'no_encontrado',
        nombre: null,
        domicilio: null,
        condicionIva: null,
        observaciones: [],
      };
    }

    const dg = persona.datosGenerales;
    const errorConstancia = persona.errorConstancia;
    let observaciones = toArray<string>(errorConstancia?.error).map((e) =>
      decodificarEntidades(String(e)),
    );
    observaciones = observaciones.map((obs) => {
      if (obs.includes('no registra Apellido y/o Nombre informados')) {
        return 'Faltan datos fiscales en AFIP (el registro está incompleto o sin impuestos activos).';
      }
      return obs;
    });

    if (!dg) {
      // ARCA no emite la constancia (requerimientos pendientes, etc.) pero el CUIT existe.
      const nombre = [errorConstancia?.apellido, errorConstancia?.nombre].filter(Boolean).join(' ');
      return {
        cuit,
        estado: 'con_observaciones',
        nombre: decodificarEntidades(nombre) || null,
        domicilio: null,
        condicionIva: null,
        observaciones,
      };
    }

    const nombre = dg.razonSocial ?? [dg.apellido, dg.nombre].filter(Boolean).join(' ');
    const dom = dg.domicilioFiscal ?? {};
    const domicilio = [dom.direccion, dom.localidad, dom.descripcionProvincia]
      .filter(Boolean)
      .join(', ');

    return {
      cuit,
      estado: String(dg.estadoClave).toUpperCase() === 'ACTIVO' ? 'activo' : 'inactivo',
      nombre: decodificarEntidades(nombre) || null,
      domicilio: decodificarEntidades(domicilio) || null,
      condicionIva: this.inferirCondicionIva(persona),
      observaciones,
    };
  }

  /** 1 = IVA RI (impuesto 30), 4 = IVA Exento (32), 6 = Monotributo. */
  private inferirCondicionIva(persona: Record<string, any>): number | null {
    if (persona.datosMonotributo) return 6;
    const impuestos = toArray<Record<string, unknown>>(persona.datosRegimenGeneral?.impuesto);
    if (impuestos.some((i) => Number(i.idImpuesto) === 30)) return 1;
    if (impuestos.some((i) => Number(i.idImpuesto) === 32)) return 4;
    return null;
  }
}
