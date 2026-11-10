/**
 * Pruebas de la normalización de CUIT/ID fiscal y de la clave de persona del chofer.
 * Ejecutar: npm run test:documento-unico
 */
import * as assert from 'node:assert/strict';
import {
  buscarChoferMismoDocumento,
  claveDniChofer,
  clavesDniChofer,
  normalizarIdFiscal,
} from './documento-unico.util';
import { formatCuit } from './cuit';
import { ChoferesService } from '../../core/choferes/choferes.service';

let fallos = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      fallos++;
      console.error(`✗ ${name}`);
      console.error(e);
    }
  })();
}

(async () => {
  await test('normalizarIdFiscal: mismo CUIT con y sin guiones', () => {
    assert.equal(normalizarIdFiscal('30-67863361-1'), '30678633611');
    assert.equal(normalizarIdFiscal('30678633611'), '30678633611');
    assert.equal(normalizarIdFiscal(' 30.678.633.611 '), '30678633611');
  });

  await test('normalizarIdFiscal: RUT chileno conserva la K', () => {
    assert.equal(normalizarIdFiscal('12.345.678-k'), '12345678K');
  });

  await test('normalizarIdFiscal: vacío → null', () => {
    assert.equal(normalizarIdFiscal(''), null);
    assert.equal(normalizarIdFiscal(' - '), null);
    assert.equal(normalizarIdFiscal(null), null);
    assert.equal(normalizarIdFiscal(undefined), null);
  });

  await test('claveDniChofer: DNI y CUIT de la misma persona coinciden', () => {
    const porCuit = claveDniChofer(null, '20-12261362-4');
    assert.equal(porCuit, '12261362');
    assert.equal(claveDniChofer('12.261.362', null), porCuit);
    assert.equal(claveDniChofer('012261362', null), porCuit);
  });

  await test('claveDniChofer: CUIT cargado en el campo DNI', () => {
    assert.equal(claveDniChofer('20122613624', null), '12261362');
  });

  await test('claveDniChofer: el DNI manda sobre el CUIT', () => {
    assert.equal(claveDniChofer('30111222', '20122613624'), '30111222');
  });

  await test('clavesDniChofer: devuelve tanto el DNI propio como el DNI dentro del CUIT cuando son distintos', () => {
    assert.deepEqual(clavesDniChofer('30111222', '20-12261362-4'), ['30111222', '12261362']);
    assert.deepEqual(clavesDniChofer('12.261.362', '20-12261362-4'), ['12261362']);
    assert.deepEqual(clavesDniChofer(null, '20-12261362-4'), ['12261362']);
    assert.deepEqual(clavesDniChofer('30111222', null), ['30111222']);
    assert.deepEqual(clavesDniChofer(null, null), []);
  });

  await test('claveDniChofer: sin documento útil → null', () => {
    assert.equal(claveDniChofer(null, null), null);
    assert.equal(claveDniChofer('', '123'), null);
  });

  await test('formatCuit: muestra con guiones lo que se guarda sin', () => {
    assert.equal(formatCuit('30678633611'), '30-67863361-1');
    assert.equal(formatCuit('30-67863361-1'), '30-67863361-1');
    assert.equal(formatCuit('12345678K'), '12345678K');
    assert.equal(formatCuit(null), '');
  });

  await test('ChoferesService.update: rechaza CUIT que contiene el DNI de otro chofer aunque el chofer editado tenga su propio DNI', async () => {
    const choferesDB = [
      { id: 'ch-a', tenantId: 'tenant-1', nombre: 'MARTINEZ DIEGO ALBERTO', dni: '31222333', cuit: null },
      { id: 'ch-b', tenantId: 'tenant-1', nombre: 'FERNANDEZ JUAN CARLOS', dni: '40841957', cuit: null },
    ];
    let valoresBuscados: unknown[] = [];
    const prismaMock = {
      chofer: {
        findFirst: async ({ where }: any) =>
          choferesDB.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null,
        update: async () => {
          throw new Error('No debería llegar a actualizar');
        },
      },
      $queryRaw: async (sql: any) => {
        valoresBuscados = sql.values ?? [];
        const match = choferesDB.find(
          (c) =>
            c.tenantId === 'tenant-1' &&
            c.id !== 'ch-a' &&
            clavesDniChofer(c.dni, c.cuit).some((k) => valoresBuscados.includes(k)),
        );
        return match ? [{ id: match.id, nombre: match.nombre }] : [];
      },
    } as any;

    const service = new ChoferesService(prismaMock);
    await assert.rejects(
      () =>
        service.update('ch-a', 'tenant-1', {
          cuit: '20-40841957-4',
        } as any),
      (err: any) => {
        assert.match(err.message, /Ya existe un chofer con ese DNI\/CUIT: FERNANDEZ JUAN CARLOS/);
        return true;
      },
    );
    assert.ok(valoresBuscados.includes('31222333'));
    assert.ok(valoresBuscados.includes('40841957'));
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodas las pruebas pasaron.');
})();
