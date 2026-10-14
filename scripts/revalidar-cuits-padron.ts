/**
 * Vuelve a consultar en el padrón de ARCA una lista de CUITs con la MISMA lógica que usa el
 * backend (`PadronService`, incluida la detección de CUIT limitada/cancelada/apócrifa).
 * Solo lectura: no toca la base. Gasta 1 request de afipsdk (PADRON_*) por CUIT.
 *
 * Uso (desde vialto-backend):
 *   npx ts-node scripts/revalidar-cuits-padron.ts 30716741792 27466553196 ...
 *
 * Para revalidar los registros ya marcados como validados (`arcaValidadoHuella`), sacar los
 * CUITs con SQL y, a los que salgan inactivos/no encontrados, limpiarles la marca
 * (`arcaValidadoHuella = NULL, arcaValidadoAt = NULL`) para que la próxima validación los rechace.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PadronService } from '../src/core/padron/padron.service';

// Carga PADRON_* del .env (sin dotenv: mismo criterio que scripts/test-padron.js).
const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
for (const n of ['PADRON_AFIP_SDK_API_KEY', 'PADRON_CUIT', 'PADRON_CERT', 'PADRON_KEY']) {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  if (m && !process.env[n]) process.env[n] = m[1].trim().replace(/^["']|["']$/g, '');
}

(async () => {
  const cuits = Array.from(new Set(process.argv.slice(2).map((c) => c.replace(/\D/g, ''))));
  if (cuits.length === 0) {
    console.log('Uso: npx ts-node scripts/revalidar-cuits-padron.ts <CUIT> [CUIT...]');
    process.exit(1);
  }
  const padron = new PadronService();
  const resultados: Record<string, unknown>[] = [];
  for (const cuit of cuits) {
    try {
      // rateKey propio: no consume el tope diario de ningún tenant.
      const r = await padron.consultar(cuit, 'script-revalidacion');
      resultados.push({ cuit, estado: r.estado, nombre: r.nombre, observaciones: r.observaciones });
    } catch (e) {
      resultados.push({ cuit, estado: 'error', error: (e as Error).message });
    }
  }
  console.log(JSON.stringify(resultados, null, 2));
  const malos = resultados.filter((r) => r.estado === 'inactivo' || r.estado === 'no_encontrado');
  console.log(`\n${cuits.length} consultados · ${malos.length} inactivos/no encontrados · ${resultados.filter((r) => r.estado === 'error').length} con error`);
})();
