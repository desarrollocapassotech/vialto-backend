export type MonedaViaje = 'ARS' | 'USD';

/** % de margen debajo del cual un viaje se considera "margen bajo" en dashboards. */
export const UMBRAL_MARGEN_BAJO_PCT = 10;

export type OtroGastoLike = { monto?: number; moneda?: string };

export type GananciaBrutaLinea = {
  moneda: MonedaViaje;
  monto: number;
  /** `manual` | `gasto_extra` | `calculada` */
  tipo: 'manual' | 'gasto_extra' | 'calculada';
};

export type GananciaBrutaResumen = {
  requiereGananciaManual: boolean;
  puedeEditarGananciaManual: boolean;
  monedaMonto: MonedaViaje;
  monedaPrecioTransportista: MonedaViaje;
  gananciaCalculada: number | null;
  monedaGananciaCalculada: MonedaViaje | null;
  gananciaBrutaManual: number | null;
  monedaGananciaBrutaManual: MonedaViaje | null;
  /** Líneas para UI (balance bimonetario o neto en una sola divisa). */
  balance: GananciaBrutaLinea[];
  mensaje: string | null;
};

export function normalizarMonedaViaje(moneda: string | null | undefined): MonedaViaje {
  return moneda === 'USD' ? 'USD' : 'ARS';
}

export function monedasFacturacionYPagoDistintas(viaje: {
  monedaMonto?: string | null;
  monedaPrecioTransportistaExterno?: string | null;
}): boolean {
  return (
    normalizarMonedaViaje(viaje.monedaMonto) !==
    normalizarMonedaViaje(viaje.monedaPrecioTransportistaExterno)
  );
}

export function sumarOtrosGastosPorMoneda(
  otrosGastos: unknown,
): Record<MonedaViaje, number> {
  const out: Record<MonedaViaje, number> = { ARS: 0, USD: 0 };
  const list = Array.isArray(otrosGastos) ? (otrosGastos as OtroGastoLike[]) : [];
  for (const g of list) {
    const m = normalizarMonedaViaje(g.moneda);
    const val = typeof g.monto === 'number' && !Number.isNaN(g.monto) ? g.monto : 0;
    out[m] += val;
  }
  return {
    ARS: roundMoney(out.ARS),
    USD: roundMoney(out.USD),
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normaliza montos persistidos (number, string numérica, etc.). */
function coerceMoneyField(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Ganancia automática cuando facturación y pago al transportista comparten moneda. */
export function calcularGananciaAutomatica(viaje: {
  monto?: number | null;
  monedaMonto?: string | null;
  precioTransportistaExterno?: number | null;
  otrosGastos?: unknown;
}): { monto: number; moneda: MonedaViaje } | null {
  const monto = viaje.monto;
  if (monto == null || monto <= 0) return null;
  const moneda = normalizarMonedaViaje(viaje.monedaMonto);
  const precio = viaje.precioTransportistaExterno ?? 0;
  const gastos = sumarOtrosGastosPorMoneda(viaje.otrosGastos);
  return {
    moneda,
    monto: roundMoney(monto - precio - gastos[moneda]),
  };
}

function buildBalanceGananciaManual(
  manual: number,
  monedaManual: MonedaViaje,
  gastos: Record<MonedaViaje, number>,
): GananciaBrutaLinea[] {
  const otra: MonedaViaje = monedaManual === 'USD' ? 'ARS' : 'USD';
  const gastosMisma = gastos[monedaManual];
  const gastosOtra = gastos[otra];

  if (gastosOtra > 0) {
    const lineas: GananciaBrutaLinea[] = [];
    if (gastosMisma > 0) {
      lineas.push({
        moneda: monedaManual,
        monto: roundMoney(manual - gastosMisma),
        tipo: 'manual',
      });
    } else {
      lineas.push({ moneda: monedaManual, monto: roundMoney(manual), tipo: 'manual' });
    }
    lineas.push({
      moneda: otra,
      monto: roundMoney(-gastosOtra),
      tipo: 'gasto_extra',
    });
    return lineas;
  }

  return [
    {
      moneda: monedaManual,
      monto: roundMoney(manual - gastosMisma),
      tipo: 'manual',
    },
  ];
}

export function buildGananciaBrutaResumen(viaje: {
  monto?: number | null;
  monedaMonto?: string | null;
  precioTransportistaExterno?: number | null;
  monedaPrecioTransportistaExterno?: string | null;
  otrosGastos?: unknown;
  gananciaBrutaManual?: number | null;
  monedaGananciaBrutaManual?: string | null;
}): GananciaBrutaResumen {
  const monedaMonto = normalizarMonedaViaje(viaje.monedaMonto);
  const monedaPrecioTransportista = normalizarMonedaViaje(
    viaje.monedaPrecioTransportistaExterno,
  );
  const requiereGananciaManual = monedasFacturacionYPagoDistintas(viaje);
  const gastos = sumarOtrosGastosPorMoneda(viaje.otrosGastos);

  if (!requiereGananciaManual) {
    const auto = calcularGananciaAutomatica(viaje);
    return {
      requiereGananciaManual: false,
      puedeEditarGananciaManual: false,
      monedaMonto,
      monedaPrecioTransportista,
      gananciaCalculada: auto?.monto ?? null,
      monedaGananciaCalculada: auto?.moneda ?? null,
      gananciaBrutaManual: null,
      monedaGananciaBrutaManual: null,
      balance: auto
        ? [{ moneda: auto.moneda, monto: auto.monto, tipo: 'calculada' }]
        : [],
      mensaje: auto ? null : 'Indicá el monto a facturar para calcular la ganancia bruta.',
    };
  }

  const monedaManual = viaje.monedaGananciaBrutaManual
    ? normalizarMonedaViaje(viaje.monedaGananciaBrutaManual)
    : monedaMonto;
  const manual = viaje.gananciaBrutaManual;

  if (manual == null || Number.isNaN(manual)) {
    return {
      requiereGananciaManual: true,
      puedeEditarGananciaManual: true,
      monedaMonto,
      monedaPrecioTransportista,
      gananciaCalculada: null,
      monedaGananciaCalculada: null,
      gananciaBrutaManual: null,
      monedaGananciaBrutaManual: null,
      balance: [],
      mensaje:
        'Las monedas de facturación y de pago al transportista son distintas. Ingresá la ganancia bruta manual y su moneda.',
    };
  }

  return {
    requiereGananciaManual: true,
    puedeEditarGananciaManual: true,
    monedaMonto,
    monedaPrecioTransportista,
    gananciaCalculada: null,
    monedaGananciaCalculada: null,
    gananciaBrutaManual: roundMoney(manual),
    monedaGananciaBrutaManual: monedaManual,
    balance: buildBalanceGananciaManual(manual, monedaManual, gastos),
    mensaje: null,
  };
}

export type GananciaBrutaPersist = {
  gananciaBrutaManual: number | null;
  monedaGananciaBrutaManual: string | null;
};

/** Valida y normaliza campos persistidos según reglas de negocio. */
export function resolveGananciaBrutaPersist(
  viaje: {
    monto?: number | null;
    monedaMonto?: string | null;
    monedaPrecioTransportistaExterno?: string | null;
    otrosGastos?: unknown;
  },
  input: {
    gananciaBrutaManual?: number | null;
    monedaGananciaBrutaManual?: string | null;
  },
  /** Valores ya guardados (p. ej. PATCH parcial que no incluye ganancia bruta). */
  existing?: {
    gananciaBrutaManual?: number | null;
    monedaGananciaBrutaManual?: string | null;
  },
): GananciaBrutaPersist {
  if (!monedasFacturacionYPagoDistintas(viaje)) {
    if (
      input.gananciaBrutaManual !== undefined &&
      input.gananciaBrutaManual !== null
    ) {
      throw new GananciaBrutaValidationError(
        'La ganancia bruta manual solo aplica cuando la moneda de facturación y la del pago al transportista son distintas.',
      );
    }
    return { gananciaBrutaManual: null, monedaGananciaBrutaManual: null };
  }

  const manual = input.gananciaBrutaManual;
  if (manual === null) {
    return { gananciaBrutaManual: null, monedaGananciaBrutaManual: null };
  }
  if (manual === undefined) {
    const prev = coerceMoneyField(existing?.gananciaBrutaManual);
    if (prev != null && prev >= 0) {
      const moneda = input.monedaGananciaBrutaManual
        ? normalizarMonedaViaje(input.monedaGananciaBrutaManual)
        : existing?.monedaGananciaBrutaManual
          ? normalizarMonedaViaje(existing.monedaGananciaBrutaManual)
          : normalizarMonedaViaje(viaje.monedaMonto);
      return {
        gananciaBrutaManual: roundMoney(prev),
        monedaGananciaBrutaManual: moneda,
      };
    }
    return { gananciaBrutaManual: null, monedaGananciaBrutaManual: null };
  }
  if (typeof manual !== 'number' || Number.isNaN(manual) || manual < 0) {
    throw new GananciaBrutaValidationError(
      'La ganancia bruta manual debe ser un número mayor o igual a 0.',
    );
  }
  const moneda = input.monedaGananciaBrutaManual
    ? normalizarMonedaViaje(input.monedaGananciaBrutaManual)
    : normalizarMonedaViaje(viaje.monedaMonto);
  return {
    gananciaBrutaManual: roundMoney(manual),
    monedaGananciaBrutaManual: moneda,
  };
}

export class GananciaBrutaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GananciaBrutaValidationError';
  }
}

/** Valor numérico para ordenar el listado por ganancia bruta (null = sin dato, va al final). */
export function gananciaBrutaValorOrdenable(viaje: {
  monto?: number | null;
  monedaMonto?: string | null;
  precioTransportistaExterno?: number | null;
  monedaPrecioTransportistaExterno?: string | null;
  otrosGastos?: unknown;
  gananciaBrutaManual?: number | null;
  monedaGananciaBrutaManual?: string | null;
}): number | null {
  const resumen = buildGananciaBrutaResumen(viaje);
  if (resumen.gananciaCalculada != null) return resumen.gananciaCalculada;
  if (resumen.gananciaBrutaManual != null) return resumen.gananciaBrutaManual;
  if (resumen.balance.length === 1) return resumen.balance[0]!.monto;
  if (resumen.balance.length > 1) {
    return resumen.balance.reduce((sum, linea) => sum + linea.monto, 0);
  }
  return null;
}

export function enrichViajeConGananciaBruta<T extends object>(viaje: T) {
  return {
    ...viaje,
    gananciaBruta: buildGananciaBrutaResumen(
      viaje as Parameters<typeof buildGananciaBrutaResumen>[0],
    ),
  };
}
