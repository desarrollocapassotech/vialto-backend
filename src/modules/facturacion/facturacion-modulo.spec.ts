/**
 * Pruebas unitarias de restricción por módulo de Facturación.
 * Ejecutar: npx ts-node src/modules/facturacion/facturacion-modulo.spec.ts
 */
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FacturacionService } from './facturacion.service';
import { PlatformController } from '../../core/platform/platform.controller';
import { ROLES_KEY } from '../../core/auth/roles.decorator';
import { ViajesProcessor } from '../importaciones/processors/viajes.processor';
import type { ValidatedRow } from '../importaciones/types/import.types';
import {
  MODULOS_FACTURACION,
  resolverModulosFacturacion,
  tieneAlgunModulo,
} from '../../shared/util/tenant-modules.util';

let fallos = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

(async () => {
  await test('FacturacionService.createFactura rechaza empresa con solo módulo viajes', async () => {
    const prismaMock = {
      tenant: {
        findUnique: async () => ({ modules: ['viajes'] }),
      },
    };
    const service = new FacturacionService(prismaMock as never, {} as never, {} as never);
    await assert.rejects(
      () =>
        service.createFactura('org_solo_viajes', {
          tipo: 'cliente',
          clienteId: 'cli_1',
          fechaEmision: '2026-11-26',
          numero: '0001-00000001',
          viajeIds: ['v_1'],
        }),
      ForbiddenException,
    );
  });

  await test('FacturacionService.createFactura permite empresa con módulo facturacion', async () => {
    let consultoCliente = false;
    const prismaMock = {
      tenant: {
        findUnique: async () => ({ modules: ['viajes', 'Facturacion'] }),
      },
      cliente: {
        findFirst: async () => {
          consultoCliente = true;
          return null;
        },
      },
    };
    const service = new FacturacionService(prismaMock as never, {} as never, {} as never);
    // Supera el control de módulo y avanza a la validación de cliente (BadRequestException)
    await assert.rejects(
      () =>
        service.createFactura('org_con_facturacion', {
          tipo: 'cliente',
          clienteId: 'cli_inexistente',
          fechaEmision: '2026-11-26',
          numero: '0001-00000001',
          viajeIds: ['v_1'],
        }),
      BadRequestException,
    );
    assert.equal(consultoCliente, true);
  });

  await test('FacturacionService.createFactura permite empresa con módulo emision-facturas-arca', async () => {
    let consultoCliente = false;
    const prismaMock = {
      tenant: {
        findUnique: async () => ({ modules: ['viajes', 'emision-facturas-arca'] }),
      },
      cliente: {
        findFirst: async () => {
          consultoCliente = true;
          return null;
        },
      },
    };
    const service = new FacturacionService(prismaMock as never, {} as never, {} as never);
    await assert.rejects(
      () =>
        service.createFactura('org_con_arca', {
          tipo: 'cliente',
          clienteId: 'cli_inexistente',
          fechaEmision: '2026-11-26',
          viajeIds: ['v_1'],
        }),
      BadRequestException,
    );
    assert.equal(consultoCliente, true);
  });

  await test('PlatformController restringe rutas de facturación y pagos a superadmin', () => {
    const metodosFacturacion: Array<keyof PlatformController> = [
      'facturas',
      'facturaNumeroInterno',
      'createFactura',
      'removeFactura',
      'marcarFacturaComoCobrada',
      'updateFactura',
      'createPago',
      'deletePago',
      'getFacturaPdf',
      'emitirFacturaArca',
      'anularFacturaArca',
      'getFacturaPdfAnulacion',
    ];
    for (const metodo of metodosFacturacion) {
      const roles = Reflect.getMetadata(ROLES_KEY, PlatformController.prototype[metodo]);
      assert.deepEqual(
        roles,
        ['superadmin'],
        `El método PlatformController.${String(metodo)} debe exigir @Roles('superadmin')`,
      );
    }
  });

  await test('ViajesProcessor no crea factura al importar viajes si la empresa no tiene Facturación', async () => {
    let facturaCreateLlamado = false;
    let datosViajeCreado: Record<string, unknown> | null = null;

    const txMock = {
      viaje: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          datosViajeCreado = data;
          return { id: 'viaje_nuevo_1' };
        },
        findUnique: async () => ({
          id: 'viaje_nuevo_1',
          transportistaId: null,
          liquidacionEstado: null,
          liquidacionesViaje: [],
        }),
        update: async () => ({ id: 'viaje_nuevo_1' }),
      },
      tenant: {
        findUnique: async () => ({ modules: ['viajes'] }),
      },
      factura: {
        findFirst: async () => {
          facturaCreateLlamado = true;
          return null;
        },
        create: async () => {
          facturaCreateLlamado = true;
          return { id: 'fac_no_debe_existir' };
        },
      },
      viajeVehiculo: {
        create: async () => ({}),
      },
      viajeProducto: {
        upsert: async () => ({}),
      },
    };

    const prismaMock = {
      viaje: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      tenant: {
        findUnique: async () => ({ modules: ['viajes'] }),
      },
      $transaction: async <T>(cb: (tx: typeof txMock) => Promise<T>) => cb(txMock),
    };

    const processor = new ViajesProcessor(prismaMock as never);
    const row = {
      _rowNum: 2,
      clienteId: 'cli_1',
      origen: 'Córdoba',
      destino: 'Rosario',
      fechaCarga: new Date('2026-11-20T00:00:00.000Z'),
      monto: 150000,
      monedaMonto: 'ARS',
      nroFactura: '0001-00000099',
    } as unknown as ValidatedRow;

    const res = await processor.insert(row, 'org_solo_viajes', 'user_1');
    assert.equal(res.creado, true);
    assert.equal(res.facturado, false);
    assert.equal(facturaCreateLlamado, false);
    assert.ok(datosViajeCreado);
    assert.equal((datosViajeCreado as Record<string, unknown>).facturaId, null);
    assert.equal((datosViajeCreado as Record<string, unknown>).facturacionEstado, 'sin_facturar');
    assert.equal((datosViajeCreado as Record<string, unknown>).nroFactura, null);
  });

  await test('ViajesProcessor.validarConsistenciaFacturas omite chequeo si la empresa no tiene Facturación', async () => {
    let consultoFacturas = false;
    const prismaMock = {
      tenant: {
        findUnique: async () => ({ modules: ['viajes'] }),
      },
      factura: {
        findMany: async () => {
          consultoFacturas = true;
          return [];
        },
      },
    };
    const processor = new ViajesProcessor(prismaMock as never);
    const rows = [
      { _rowNum: 2, clienteId: 'cli_1', nroFactura: '0001-00000010' },
      { _rowNum: 3, clienteId: 'cli_2', nroFactura: '0001-00000010' },
    ] as unknown as ValidatedRow[];
    const inconsistencias = await processor.validarConsistenciaFacturas(
      rows,
      'org_solo_viajes',
    );
    assert.deepEqual(inconsistencias, []);
    assert.equal(consultoFacturas, false);
  });

  await test('tenant-modules.util compara módulos de forma case-insensitive', () => {
    assert.equal(tieneAlgunModulo(['Viajes'], MODULOS_FACTURACION), false);
    assert.equal(tieneAlgunModulo(['Viajes', 'Facturacion'], MODULOS_FACTURACION), true);
    assert.deepEqual(resolverModulosFacturacion(['viajes']), {
      tieneFacturacion: false,
      tieneArca: false,
    });
    assert.deepEqual(resolverModulosFacturacion(['EMISION-FACTURAS-ARCA']), {
      tieneFacturacion: true,
      tieneArca: true,
    });
  });

  if (fallos > 0) {
    console.error(`\n${fallos} prueba(s) fallaron`);
    process.exit(1);
  }
})();
