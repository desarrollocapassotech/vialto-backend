"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const afectados = await prisma.viaje.findMany({
        where: { estado: 'facturado_sin_cobrar', facturaId: null },
        select: { id: true, tenantId: true, numero: true },
    });
    console.log(`Viajes a corregir: ${afectados.length}`);
    if (afectados.length === 0) {
        console.log('Nada que hacer.');
        return;
    }
    for (const v of afectados) {
        console.log(`  [${v.tenantId}] ${v.numero} (${v.id})`);
    }
    const result = await prisma.viaje.updateMany({
        where: { estado: 'facturado_sin_cobrar', facturaId: null },
        data: { estado: 'finalizado_sin_facturar' },
    });
    console.log(`\nActualizados: ${result.count} viajes → 'finalizado_sin_facturar'`);
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=fix-viajes-estado-desvinculados.js.map