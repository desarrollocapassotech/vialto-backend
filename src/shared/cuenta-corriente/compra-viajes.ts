import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Compras de Cuenta corriente vinculadas a viajes (nov 2026).
 *
 * Una compra manual (cargo de un proveedor de cualquier tipo) se puede vincular, de forma
 * opcional, a uno o varios viajes, repartiendo su importe NETO (sin IVA: el IVA de una
 * compra es crédito fiscal, no costo). La fuente de verdad es `CompraViaje`; cada vínculo
 * se refleja en `Viaje.otrosGastos` como una línea con `ccCompraId`, que el viaje no deja
 * editar ni borrar (`mergeGastosConCompras`). Así la compra resta en la ganancia bruta, los
 * dashboards y el Excel del viaje sin tocar esos cálculos. Las liquidaciones no leen
 * `otrosGastos`, así que no cambian.
 */

export interface CompraViajeInput {
  viajeId: string;
  importe: number;
}

/** Línea de `Viaje.otrosGastos` que refleja una compra. */
interface GastoViaje {
  descripcion?: string;
  monto?: number;
  moneda?: string;
  fecha?: string;
  createdBy?: string;
  ccCompraId?: string;
  [k: string]: unknown;
}

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parte del importe de la compra que se reparte entre los viajes: el neto (sin IVA). */
export function netoCompra(mov: { importe: number; importeNeto: number | null }): number {
  return round2(mov.importeNeto ?? mov.importe);
}

/**
 * Valida y normaliza el reparto: viajes sin repetir, importes > 0 y la suma igual al neto.
 * Con `[]` la compra queda sin viajes (la vinculación es opcional).
 */
export function normalizarRepartoCompra(viajes: CompraViajeInput[], neto: number): CompraViajeInput[] {
  const vistos = new Set<string>();
  const out: CompraViajeInput[] = [];
  for (const v of viajes) {
    if (!v.viajeId || vistos.has(v.viajeId)) {
      throw new BadRequestException('Hay un viaje repetido en el reparto de la compra');
    }
    vistos.add(v.viajeId);
    const importe = round2(Number(v.importe));
    if (!Number.isFinite(importe) || importe <= 0) {
      throw new BadRequestException('Cada viaje tiene que llevar un importe mayor a cero');
    }
    out.push({ viajeId: v.viajeId, importe });
  }
  if (out.length > 0) {
    const suma = round2(out.reduce((s, v) => s + v.importe, 0));
    if (Math.abs(suma - neto) > 0.01) {
      throw new BadRequestException(
        `El reparto entre los viajes (${suma.toFixed(2)}) tiene que sumar el importe sin IVA de la compra (${neto.toFixed(2)})`,
      );
    }
  }
  return out;
}

/**
 * Reescala un reparto existente a un neto nuevo (ej. se editó el importe de la compra sin
 * tocar los viajes), proporcional a lo que tenía cada uno. El redondeo sobrante va al último.
 */
export function reescalarReparto(actual: CompraViajeInput[], neto: number): CompraViajeInput[] {
  const total = actual.reduce((s, v) => s + v.importe, 0);
  if (actual.length === 0 || total <= EPS) return actual;
  let acumulado = 0;
  return actual.map((v, i) => {
    const importe =
      i === actual.length - 1 ? round2(neto - acumulado) : round2((v.importe / total) * neto);
    acumulado = round2(acumulado + importe);
    return { viajeId: v.viajeId, importe };
  });
}

async function assertViajesDeLaEmpresa(tx: Tx, tenantId: string, viajeIds: string[]) {
  if (viajeIds.length === 0) return;
  const encontrados = await tx.viaje.count({ where: { tenantId, id: { in: viajeIds } } });
  if (encontrados !== viajeIds.length) {
    throw new BadRequestException('Uno de los viajes elegidos no existe en esta empresa');
  }
}

/**
 * Reemplaza los viajes de una compra y refleja el cambio en los gastos de cada viaje
 * afectado (los que tenía y los que tiene ahora).
 */
export async function guardarViajesDeCompra(
  tx: Tx,
  tenantId: string,
  movimientoId: string,
  viajes: CompraViajeInput[],
) {
  await assertViajesDeLaEmpresa(tx, tenantId, viajes.map((v) => v.viajeId));
  const anteriores = await tx.compraViaje.findMany({
    where: { tenantId, movimientoId },
    select: { viajeId: true },
  });
  await tx.compraViaje.deleteMany({ where: { tenantId, movimientoId } });
  if (viajes.length > 0) {
    await tx.compraViaje.createMany({
      data: viajes.map((v) => ({ tenantId, movimientoId, viajeId: v.viajeId, importe: v.importe })),
    });
  }
  const afectados = new Set([...anteriores.map((a) => a.viajeId), ...viajes.map((v) => v.viajeId)]);
  await reflejarCompraEnViajes(tx, tenantId, movimientoId, [...afectados]);
}

/** Reparto actual de una compra (para reescalarlo o mostrarlo). */
export async function viajesDeCompra(tx: Tx, tenantId: string, movimientoId: string) {
  const rows = await tx.compraViaje.findMany({
    where: { tenantId, movimientoId },
    orderBy: { createdAt: 'asc' },
    select: { viajeId: true, importe: true },
  });
  return rows as CompraViajeInput[];
}

/**
 * Reescribe en `otrosGastos` de cada viaje la línea de esta compra: la saca y, si la
 * compra sigue vigente y vinculada a ese viaje, la vuelve a poner con los datos actuales.
 * Se llama después de crear/editar la compra y antes de eliminarla (con `quitar`).
 */
export async function reflejarCompraEnViajes(
  tx: Tx,
  tenantId: string,
  movimientoId: string,
  viajeIds: string[],
  opts: { quitar?: boolean } = {},
) {
  if (viajeIds.length === 0) return;
  const mov = opts.quitar
    ? null
    : await tx.movimientoCuentaCorriente.findFirst({
        where: { id: movimientoId, tenantId },
        select: {
          moneda: true,
          fecha: true,
          numeroComprobante: true,
          estadoDisponibilidad: true,
          createdBy: true,
          proveedor: { select: { nombre: true } },
          viajesCompra: { select: { viajeId: true, importe: true } },
        },
      });
  const vigente = mov && mov.estadoDisponibilidad !== 'anulado';
  const importePorViaje = new Map((mov?.viajesCompra ?? []).map((v) => [v.viajeId, v.importe]));

  const viajes = await tx.viaje.findMany({
    where: { tenantId, id: { in: viajeIds } },
    select: { id: true, otrosGastos: true },
  });
  for (const viaje of viajes) {
    const actuales = (Array.isArray(viaje.otrosGastos) ? viaje.otrosGastos : []) as GastoViaje[];
    const sinEsta = actuales.filter((g) => g.ccCompraId !== movimientoId);
    const importe = importePorViaje.get(viaje.id);
    const nuevos =
      vigente && importe != null
        ? [...sinEsta, lineaDeCompra(movimientoId, importe, mov!)]
        : sinEsta;
    if (nuevos.length === actuales.length && importe == null) continue;
    await tx.viaje.updateMany({
      where: { id: viaje.id, tenantId },
      data: { otrosGastos: nuevos as unknown as Prisma.InputJsonValue },
    });
  }
}

function lineaDeCompra(
  movimientoId: string,
  importe: number,
  mov: {
    moneda: string;
    fecha: Date;
    numeroComprobante: string | null;
    createdBy: string | null;
    proveedor: { nombre: string } | null;
  },
): GastoViaje {
  const partes = ['Compra', mov.proveedor?.nombre, mov.numeroComprobante].filter(Boolean);
  const linea: GastoViaje = {
    descripcion: partes.join(' · '),
    monto: importe,
    moneda: mov.moneda === 'USD' ? 'USD' : 'ARS',
    fecha: mov.fecha.toISOString().slice(0, 10),
    ccCompraId: movimientoId,
  };
  if (mov.createdBy) linea.createdBy = mov.createdBy;
  return linea;
}

/**
 * Al guardar los gastos de un viaje desde su formulario: las líneas que vienen de compras
 * no se editan desde ahí. Se descartan las que lleguen (o copias sin `ccCompraId` con la
 * misma descripción, monto y moneda) y se conservan las que ya tenía el viaje.
 */
export function mergeGastosConCompras(entrantes: unknown, actuales: unknown): GastoViaje[] {
  const previas = ((Array.isArray(actuales) ? actuales : []) as GastoViaje[]).filter(
    (g) => !!g.ccCompraId,
  );
  const clave = (g: GastoViaje) => `${g.descripcion ?? ''}|${g.monto ?? ''}|${g.moneda ?? ''}`;
  const clavesCompras = new Set(previas.map(clave));
  const manuales = ((Array.isArray(entrantes) ? entrantes : []) as GastoViaje[]).filter(
    (g) => !g.ccCompraId && !clavesCompras.has(clave(g)),
  );
  return [...manuales, ...previas];
}
