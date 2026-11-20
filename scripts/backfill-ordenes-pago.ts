/**
 * Numera como orden de pago (`0001-00000001`) los pagos a proveedor cargados a mano en Cuenta
 * corriente ANTES de que el sistema las numerara solo (nov 2026, ver `siguienteNumeroOrdenPago`
 * en `shared/util/numero-interno.util.ts`) y que quedaron sin número.
 *
 * Por qué: el PDF de la orden de pago de esos pagos salía con "N°: s/n".
 *
 * Qué toma, por empresa: pagos (`tipo: 'pago'`) a proveedor, `origen: 'manual'`, sin número
 * (null o vacío), incluidos los que se crearon desde Viajes. Los numera del más viejo al más
 * nuevo (fecha y fecha de carga), siguiendo la serie: después de la última orden ya numerada.
 * En un pago que viene de Viajes (`viajeId`) copia además el número al pago cargado en el
 * viaje (`Viaje.pagosTransportista[].comprobante` de la entrada con ese `ccPagoId`), para
 * que el viaje y Cuenta corriente muestren lo mismo; si esa entrada ya tenía comprobante,
 * no la pisa.
 * No toca pagos que ya tienen número (de orden de pago o cualquier otro). Idempotente.
 *
 * Todo corre en UNA transacción: sin --apply se deshace al final (vista previa con el mismo
 * resultado que tendría aplicarlo).
 *
 * Uso (la base sale de DATABASE_URL):
 *   npm run backfill:ordenes-pago:dry                       ← vista previa, todas las empresas
 *   npm run backfill:ordenes-pago:dry -- --tenant-id org_x  ← vista previa, una empresa
 *   npm run backfill:ordenes-pago [-- --tenant-id org_x]    ← aplica
 */

import { PrismaClient } from "@prisma/client";
import { siguienteNumeroOrdenPago } from "../src/shared/util/numero-interno.util";

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const i = args.indexOf("--tenant-id");
  const tenantId = i !== -1 ? args[i + 1] : undefined;
  return { apply, tenantId };
}

/** Error para deshacer la transacción en la vista previa. */
class VistaPrevia extends Error {}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Copia el número al pago cargado en el viaje (entrada de `pagosTransportista` con ese
 * `ccPagoId`), si esa entrada no tiene comprobante. Devuelve cómo quedó para el log:
 * "copiado", "ya tenía comprobante" o "sin entrada en el viaje".
 */
async function copiarAlViaje(
  tx: Tx,
  tenantId: string,
  viajeId: string,
  ccPagoId: string,
  numero: string,
): Promise<string> {
  const viaje = await tx.viaje.findFirst({
    where: { id: viajeId, tenantId },
    select: { pagosTransportista: true, numero: true },
  });
  const pagos = Array.isArray(viaje?.pagosTransportista)
    ? (viaje!.pagosTransportista as Record<string, unknown>[])
    : [];
  const i = pagos.findIndex((e) => e && String(e.ccPagoId ?? "") === ccPagoId);
  if (!viaje || i === -1) return "sin entrada en el viaje";
  if (String(pagos[i].comprobante ?? "").trim()) return `${viaje.numero}: ya tenía comprobante`;
  const nuevos = pagos.map((e, j) => (j === i ? { ...e, comprobante: numero } : e));
  await tx.viaje.updateMany({
    where: { id: viajeId, tenantId },
    data: { pagosTransportista: nuevos as unknown as object },
  });
  return `${viaje.numero}: copiado`;
}

async function main() {
  const { apply, tenantId } = parseArgs();
  console.log(`\n${apply ? "APLICANDO" : "VISTA PREVIA (sin --apply no se guarda nada)"}\n`);

  let total = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        const pagos = await tx.movimientoCuentaCorriente.findMany({
          where: {
            ...(tenantId ? { tenantId } : {}),
            tipo: "pago",
            origen: "manual",
            proveedorId: { not: null },
            OR: [{ numeroComprobante: null }, { numeroComprobante: "" }],
          },
          orderBy: [{ tenantId: "asc" }, { fecha: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            tenantId: true,
            fecha: true,
            viajeId: true,
            importe: true,
            moneda: true,
            proveedor: { select: { nombre: true } },
          },
        });

        const porTenant = new Map<string, typeof pagos>();
        for (const p of pagos) porTenant.set(p.tenantId, [...(porTenant.get(p.tenantId) ?? []), p]);

        for (const [tid, lista] of porTenant) {
          const tenant = await tx.tenant.findUnique({
            where: { clerkOrgId: tid },
            select: { name: true },
          });
          // Siguiente libre de la serie; de ahí en adelante, correlativo.
          const primero = await siguienteNumeroOrdenPago(tx, tid);
          let n = Number(primero.slice(5));
          console.log(`${tenant?.name ?? tid} (${tid}): ${lista.length} pago(s) sin número`);
          for (const p of lista) {
            const numero = `0001-${String(n).padStart(8, "0")}`;
            n += 1;
            await tx.movimientoCuentaCorriente.updateMany({
              where: { id: p.id, tenantId: tid },
              data: { numeroComprobante: numero },
            });
            const enViaje = p.viajeId ? await copiarAlViaje(tx, tid, p.viajeId, p.id, numero) : null;
            console.log(
              `  ${numero}  ${p.fecha.toISOString().slice(0, 10)}  ${p.proveedor?.nombre ?? "—"}  ${p.importe} ${p.moneda}${
                enViaje ? `  (viaje ${enViaje})` : ""
              }`,
            );
            total += 1;
          }
        }

        console.log(`\nTotal: ${total} pago(s) ${apply ? "numerados" : "a numerar"}.`);
        if (!apply) throw new VistaPrevia();
      },
      { timeout: 120_000 },
    );
  } catch (e) {
    if (!(e instanceof VistaPrevia)) throw e;
    console.log("Vista previa: no se guardó nada. Para aplicar, correr sin :dry.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
