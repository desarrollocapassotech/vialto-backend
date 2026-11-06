import { roundMoney2 } from '../../shared/util/factura-estado-lectura';

export type FilaSaldoCc = {
  contraparteId: string;
  moneda: string;
  tipo: string;
  importe: number;
};

/**
 * Saldo de cada cuenta por moneda: cargos − pagos (mismo criterio que `saldoContraparte`).
 * Los créditos no suman: se anulan junto con su original. Una moneda que queda en cero no se
 * informa, así una cuenta saldada aparece sin saldo. Las monedas nunca se suman entre sí.
 */
export function saldosPorContraparte(filas: FilaSaldoCc[]) {
  const porCuenta = new Map<string, Map<string, number>>();
  for (const f of filas) {
    if (f.tipo !== 'cargo' && f.tipo !== 'pago') continue;
    const monedas = porCuenta.get(f.contraparteId) ?? new Map<string, number>();
    const signo = f.tipo === 'cargo' ? 1 : -1;
    monedas.set(f.moneda, (monedas.get(f.moneda) ?? 0) + signo * f.importe);
    porCuenta.set(f.contraparteId, monedas);
  }
  return Array.from(porCuenta, ([contraparteId, monedas]) => ({
    contraparteId,
    saldos: Array.from(monedas, ([moneda, saldo]) => ({
      moneda,
      saldo: roundMoney2(saldo),
    })).filter((s) => Math.abs(s.saldo) > 0.005),
  }));
}
