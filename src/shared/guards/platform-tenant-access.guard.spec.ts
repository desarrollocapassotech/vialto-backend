/**
 * Pruebas de PlatformTenantAccessGuard (acceso cross-tenant en /platform).
 * Ejecutar: npm run test:platform-guard
 */
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PlatformTenantAccessGuard } from './platform-tenant-access.guard';

const guard = new PlatformTenantAccessGuard();
let fallos = 0;

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    fallos++;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

const admin = { userId: 'u1', tenantId: 'org_A', role: 'admin' };

test('superadmin pasa con cualquier tenantId', () => {
  assert.equal(
    guard.canActivate(ctx({ auth: { userId: 's', tenantId: null, role: 'superadmin' }, query: { tenantId: 'org_B' } })),
    true,
  );
});

test('admin con su propio tenantId pasa', () => {
  assert.equal(guard.canActivate(ctx({ auth: admin, query: { tenantId: 'org_A' }, params: {} })), true);
});

test('admin sin tenantId en el request pasa', () => {
  assert.equal(guard.canActivate(ctx({ auth: admin, query: {}, params: {} })), true);
});

test('admin con otro tenantId en query → 403', () => {
  assert.throws(() => guard.canActivate(ctx({ auth: admin, query: { tenantId: 'org_B' } })), ForbiddenException);
});

test('member con otro tenantId en params (:tenantId) → 403', () => {
  assert.throws(
    () => guard.canActivate(ctx({ auth: { ...admin, role: 'member' }, query: {}, params: { tenantId: 'org_B' } })),
    ForbiddenException,
  );
});

test('admin con otro tenantId en body → 403', () => {
  assert.throws(
    () => guard.canActivate(ctx({ auth: admin, query: { tenantId: 'org_A' }, body: { tenantId: 'org_B' } })),
    ForbiddenException,
  );
});

test('tenantId repetido en query con uno ajeno → 403', () => {
  assert.throws(
    () => guard.canActivate(ctx({ auth: admin, query: { tenantId: ['org_A', 'org_B'] } })),
    ForbiddenException,
  );
});

test('usuario sin organización que manda tenantId → 403', () => {
  assert.throws(
    () => guard.canActivate(ctx({ auth: { userId: 'u2', tenantId: null, role: 'member' }, query: { tenantId: 'org_A' } })),
    ForbiddenException,
  );
});

test('tenantId con espacios alrededor se compara recortado', () => {
  assert.equal(guard.canActivate(ctx({ auth: admin, query: { tenantId: ' org_A ' } })), true);
});

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
