/**
 * Genera en Cuenta corriente el PAGO de cada pago al transportista cargado desde Viajes
 * antes de que ese camino lo hiciera solo (nov 2026, ver `viaje-pago-cuenta-corriente.ts`).
 *
 * Por qué: esos pagos solo vivían en `Viaje.pagosTransportista`; en Cuenta corriente no
 * había PAGO y el saldo del proveedor seguía mostrando la deuda (LSF).
 *
 * Qué hace, por viaje con pagos sin vínculo (sin `ccPagoId` ni `ccImputacionId`):
 * 1. Si ya hay un PAGO manual en Cuenta corriente del mismo proveedor, moneda e importe,
 *    con fecha a ±3 días y sin viaje (el usuario lo cargó a mano también), lo VINCULA al
 *    pago del viaje en vez de crear otro: así no queda pagado dos veces.
 * 2. Corre `sincronizarPagosCcDelViaje` (la misma función de la app): crea los PAGOS que
 *    faltan y los imputa a la liquidación vigente del viaje (hasta su saldo; lo que sobra
 *    queda a cuenta).
 * Idempotente: los pagos que ya tienen vínculo se saltean.
 *
 * Todo corre en UNA transacción: sin --apply se deshace al final (vista previa con el
 * mismo resultado que tendría aplicarlo).
 *
 * Uso (la base sale de DATABASE_URL):
 *   npm run backfill:pagos-viaje-cc:dry -- --tenant-id org_xxx   ← vista previa
 *   npm run backfill:pagos-viaje-cc -- --tenant-id org_xxx       ← aplica
 */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  proveedorDePagosDelViaje,
  sincronizarPagosCcDelViaje,
} from "../src/modules/viajes/viaje-pago-cuenta-corriente";
import { fechaCalendarioAr } from "../src/shared/util/fecha-ar.util";

const prisma = new PrismaClient();
const DIA = 24 * 60 * 60 * 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const i = args.indexOf("--tenant-id");
  const tenantId = i !== -1 ? args[i + 1] : undefined;
  if (!tenantId) throw new Error("Falta --tenant-id org_xxx");
  return { apply, tenantId };
}

type Entrada = Record<string, unknown>;
const sinVinculo = (p: Entrada) =>
  !String(p.ccPagoId ?? "").trim() && !String(p.ccImputacionId ?? "").trim();

async function saldosProveedores(tx: Prisma.TransactionClient, tenantId: string) {
  const rows = await tx.movimientoCuentaCorriente.groupBy({
    by: ["proveedorId", "moneda", "tipo"],
    where: { tenantId, proveedorId: { not: null }, estadoDisponibilidad: { not: "anulado" } },
    _sum: { importe: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.tipo === "credito") continue;
    const k = `${r.proveedorId}|${r.moneda}`;
    const signo = r.tipo === "cargo" ? 1 : -1;
    out.set(k, (out.get(k) ?? 0) + signo * (r._sum.importe ?? 0));
  }
  return out;
}

class Rollback extends Error {}

async function main() {
  const { apply, tenantId } = parseArgs();
  const tenant = await prisma.tenant.findFirst({ where: { clerkOrgId: tenantId }, select: { name: true } });
  if (!tenant) throw new Error(`No existe el tenant ${tenantId}`);
  console.log(`\nBackfill PAGOS de viajes → Cuenta corriente — ${apply ? "APLICANDO" : "VISTA PREVIA"} — ${tenant.name}\n`);

  const nombres = new Map(
    (await prisma.transportista.findMany({ where: { tenantId }, select: { id: true, nombre: true } })).map(
      (t) => [t.id, t.nombre],
    ),
  );

  try {
    await prisma.$transaction(
      async (tx) => {
        const saldosAntes = await saldosProveedores(tx, tenantId);
        const pagosAntes = await tx.movimientoCuentaCorriente.count({ where: { tenantId, tipo: "pago", viajeId: { not: null } } });
        const impAntes = await tx.imputacionCuentaCorriente.aggregate({ where: { tenantId }, _sum: { importe: true }, _count: true });

        const viajes = await tx.viaje.findMany({
          where: { tenantId, transportistaId: { not: null } },
          select: { id: true, numero: true, transportistaId: true, transportistaEfectivoId: true, pagosTransportista: true },
          orderBy: { createdAt: "asc" },
        });
        const conPendientes = viajes.filter(
          (v) => Array.isArray(v.pagosTransportista) && (v.pagosTransportista as Entrada[]).some(sinVinculo),
        );

        const usados = new Set<string>();
        const vinculados: string[] = [];
        for (const v of conPendientes) {
          const entradas = (v.pagosTransportista as Entrada[]).map((p) => ({ ...p }));
          const proveedorId = await proveedorDePagosDelViaje(tx, tenantId, v);
          let cambio = false;
          for (const e of entradas) {
            if (!sinVinculo(e) || !proveedorId) continue;
            const monto = Number(e.monto) || 0;
            const fecha = fechaCalendarioAr(String(e.fecha ?? "").slice(0, 10) || undefined);
            const candidato = await tx.movimientoCuentaCorriente.findFirst({
              where: {
                tenantId,
                tipo: "pago",
                origen: "manual",
                viajeId: null,
                proveedorId,
                moneda: e.moneda === "USD" ? "USD" : "ARS",
                importe: { gte: monto - 0.01, lte: monto + 0.01 },
                fecha: { gte: new Date(fecha.getTime() - 3 * DIA), lte: new Date(fecha.getTime() + 3 * DIA) },
                id: { notIn: [...usados] },
              },
              orderBy: { createdAt: "asc" },
            });
            if (!candidato) continue;
            usados.add(candidato.id);
            await tx.movimientoCuentaCorriente.update({ where: { id: candidato.id }, data: { viajeId: v.id } });
            e.ccPagoId = candidato.id;
            cambio = true;
            vinculados.push(
              `  viaje ${v.numero} · ${nombres.get(proveedorId) ?? proveedorId} · ${e.moneda ?? "ARS"} ${monto} · ${String(e.fecha)} → PAGO existente ${candidato.numeroComprobante ?? candidato.id}`,
            );
          }
          if (cambio) {
            await tx.viaje.update({ where: { id: v.id }, data: { pagosTransportista: entradas as unknown as Prisma.InputJsonValue } });
          }
          await sincronizarPagosCcDelViaje(tx, tenantId, v.id, "backfill-pagos-viaje-cc");
        }

        const pagosDespues = await tx.movimientoCuentaCorriente.findMany({ where: { tenantId, tipo: "pago", viajeId: { not: null } } });
        const impDespues = await tx.imputacionCuentaCorriente.aggregate({ where: { tenantId }, _sum: { importe: true }, _count: true });
        const saldosDespues = await saldosProveedores(tx, tenantId);

        const porMoneda = (m: string) =>
          pagosDespues.filter((p) => p.moneda === m).reduce((s, p) => s + p.importe, 0);
        const aCuenta = pagosDespues.filter((p) => p.estadoImputacion !== "imputado");

        console.log(`Viajes con pagos sin PAGO en CC: ${conPendientes.length}`);
        console.log(`PAGOS vinculados a uno ya cargado a mano: ${vinculados.length}`);
        vinculados.forEach((l) => console.log(l));
        console.log(`PAGOS de viaje en CC: ${pagosAntes} → ${pagosDespues.length} (nuevos: ${pagosDespues.length - pagosAntes - vinculados.length})`);
        console.log(`  total ARS ${porMoneda("ARS").toFixed(2)} · USD ${porMoneda("USD").toFixed(2)}`);
        console.log(
          `Imputaciones: ${impAntes._count} → ${impDespues._count} (+${((impDespues._sum.importe ?? 0) - (impAntes._sum.importe ?? 0)).toFixed(2)} imputado)`,
        );
        console.log(`PAGOS que quedan total o parcialmente a cuenta: ${aCuenta.length}`);

        console.log(`\nSaldo por proveedor (lo que se le debe; negativo = pagado de más / anticipo):`);
        const claves = [...new Set([...saldosAntes.keys(), ...saldosDespues.keys()])];
        const filas = claves
          .map((k) => {
            const [prov, mon] = k.split("|");
            return { prov, mon, antes: saldosAntes.get(k) ?? 0, despues: saldosDespues.get(k) ?? 0 };
          })
          .filter((f) => Math.abs(f.antes - f.despues) > 0.005)
          .sort((a, b) => (nombres.get(a.prov) ?? "").localeCompare(nombres.get(b.prov) ?? ""));
        for (const f of filas) {
          console.log(
            `  ${(nombres.get(f.prov) ?? f.prov).padEnd(40).slice(0, 40)} ${f.mon}  ${f.antes.toFixed(2).padStart(14)} → ${f.despues.toFixed(2).padStart(14)}`,
          );
        }
        const negativos = filas.filter((f) => f.despues < -0.005);
        if (negativos.length) {
          console.log(`\n⚠ ${negativos.length} cuenta(s) quedan con saldo negativo (pagos de viajes todavía sin liquidar, o pagado de más).`);
        }

        if (!apply) throw new Rollback();
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    console.log("\nAplicado.");
  } catch (e) {
    if (e instanceof Rollback) {
      console.log("\nVista previa: no se guardó nada. Para aplicar, correr con --apply.");
      return;
    }
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
