"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const templates = await prisma.importTemplate.findMany({
        where: { modulo: 'viajes' }
    });
    console.log("Found templates:", templates.length);
    for (const t of templates) {
        const config = t.config;
        const col = config.columns.find((c) => c.field === 'precioTransportistaExterno');
        console.log(`Tenant ${t.tenantId} template:`, col);
    }
}
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=check-db.js.map