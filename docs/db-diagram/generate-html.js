#!/usr/bin/env node
/**
 * Regenera index.html a partir de vialto.dbml (fuente de verdad).
 * Uso: node generate-html.js [ruta-a-vialto.dbml] [ruta-a-index.html]
 * Sin argumentos, usa los archivos en la misma carpeta que este script.
 *
 * Requiere @dbml/core, que NO es una dependencia del proyecto (es solo para
 * este script de docs). Correr con:
 *   npx --package=@dbml/core -- node docs/db-diagram/generate-html.js
 */
const fs = require('fs');
const path = require('path');
const { Parser } = require('@dbml/core');

const DBML_PATH = process.argv[2] || path.join(__dirname, 'vialto.dbml');
const HTML_PATH = process.argv[3] || path.join(__dirname, 'index.html');

const dbmlSrc = fs.readFileSync(DBML_PATH, 'utf8');
const db = new Parser().parse(dbmlSrc, 'dbmlv2');
const schema = db.schemas[0];

// Definición de módulos: qué tablas van en cada sección del HTML (agrupamiento lógico,
// no tiene que coincidir con el orden físico de schema.prisma). Al agregar un modelo
// nuevo en schema.prisma + vialto.dbml, sumarlo acá al módulo que corresponda.
const MODULE_DEFS = [
  { id: 'core', name: 'CORE', color: '#1B4F72', bg: '#D4E6F1', status: 'IMPLEMENTADO', phase: 'Core — siempre presente',
    tables: ['tenants', 'clientes', 'transportistas', 'choferes', 'paises', 'destinatarios', 'direcciones_entrega', 'vehiculos', 'tenant_field_configs', 'tenant_field_config_audit_logs'] },
  { id: 'viajes', name: 'VIAJES', color: '#117A65', bg: '#D5F5E3', status: 'IMPLEMENTADO', phase: 'Fase 1+',
    tables: ['viajes', 'viajes_clientes', 'viajes_clientes_destinos', 'viajes_clientes_productos', 'viajes_vehiculos', 'viajes_productos', 'viajes_destinos'] },
  { id: 'facturacion', name: 'FACTURACION', color: '#B9770E', bg: '#FCF3CF', status: 'IMPLEMENTADO', phase: 'Fase 5+',
    tables: ['facturas', 'factura_tramos', 'pagos'] },
  { id: 'cuenta_corriente', name: 'CUENTA_CORRIENTE', color: '#6C3483', bg: '#E8DAEF', status: 'IMPLEMENTADO', phase: 'Fase 2',
    tables: ['movimientos_cuenta_corriente'] },
  { id: 'stock', name: 'STOCK', color: '#1D8348', bg: '#D4EFDF', status: 'IMPLEMENTADO', phase: 'Fase 2',
    tables: ['productos', 'presentaciones', 'producto_presentaciones', 'producto_secuencias', 'depositos', 'stock_operaciones', 'movimientos_stock', 'stock_items', 'stock_remito_secuencias', 'stock_egreso_remito_configs'] },
  { id: 'combustible', name: 'COMBUSTIBLE', color: '#922B21', bg: '#FADBD8', status: 'IMPLEMENTADO', phase: 'Fase 4',
    tables: ['cargas_combustible', 'combustible_sync_error_logs'] },
  { id: 'mantenimiento', name: 'MANTENIMIENTO', color: '#5D6D7E', bg: '#EBEDEF', status: 'IMPLEMENTADO', phase: 'Fase 4 — checklist en Firestore',
    tables: ['intervenciones'] },
  { id: 'remitos', name: 'REMITOS', color: '#873600', bg: '#FDEBD0', status: 'IMPLEMENTADO', phase: 'Fase 3',
    tables: ['remitos'] },
  { id: 'importaciones', name: 'IMPORTACIONES', color: '#1A5276', bg: '#D6EAF8', status: 'IMPLEMENTADO', phase: 'Transversal',
    tables: ['import_templates', 'import_sessions', 'import_logs'] },
  { id: 'notificaciones', name: 'NOTIFICACIONES', color: '#B7950B', bg: '#FEF9E7', status: 'IMPLEMENTADO', phase: 'Transversal — alertas por email (Resend)',
    tables: ['notificacion_configs', 'notificacion_envios'] },
  { id: 'integracion_arca', name: 'INTEGRACION_ARCA', color: '#7D3C98', bg: '#F5EEF8', status: 'IMPLEMENTADO', phase: 'Fase NyM',
    tables: ['arca_configs', 'liquidaciones', 'conceptos_liquidacion', 'liquidacion_concepto_lineas', 'liquidacion_viajes', 'arca_logs'] },
  { id: 'planificado', name: 'PLANIFICADO', color: '#95A5A6', bg: '#F2F3F4', status: 'PLANIFICADO', phase: 'Roadmap — no en schema.prisma',
    tables: ['tenant_configs', 'users_clerk_sync', 'viajes_metadata_note', 'turnos', 'reportes_snapshots', 'afip_comprobantes_generales'] },
];

const tablesByName = {};
for (const t of schema.tables) tablesByName[t.name] = t;

function fieldToStr(f) {
  const out = [`${f.name} ${f.type.type_name}`];
  const attrs = [];
  if (f.pk) attrs.push('pk');
  if (f.unique && !f.pk) attrs.push('unique');
  if (f.not_null && !f.pk) attrs.push('not null');
  if (f.dbdefault) {
    const v = f.dbdefault;
    attrs.push(v.type === 'expression' ? `default: \`${v.value}\`` : `default: ${typeof v.value === 'string' ? `'${v.value}'` : v.value}`);
  }
  if (typeof f.note === 'string' && f.note) attrs.push(`note: '${f.note.replace(/'/g, "\\'")}'`);
  if (attrs.length) out.push(`[${attrs.join(', ')}]`);
  return out.join(' ');
}

function indexToStr(idx) {
  const cols = idx.columns.map((c) => c.value).join(', ');
  const base = idx.columns.length > 1 ? `(${cols})` : cols;
  return idx.unique ? `${base} [unique]` : base;
}

// Una FK real en DBML es el endpoint "many" (relation '*'); el otro extremo ("one") es la
// tabla/columna referenciada (pk o unique).
const allRefs = schema.refs.map((ref) => {
  const [a, b] = ref.endpoints;
  const fk = a.relation === '*' ? a : b;
  const one = fk === a ? b : a;
  return { fromTable: fk.tableName, fromField: fk.fieldNames[0], toTable: one.tableName };
});

const refsByFromTable = {};
for (const r of allRefs) (refsByFromTable[r.fromTable] ||= []).push(r);

function buildCard(tableName) {
  const t = tablesByName[tableName];
  if (!t) throw new Error(`Tabla no encontrada en el DBML: ${tableName} (¿falta agregarla a vialto.dbml, o al MODULE_DEFS de este script?)`);
  const fks = refsByFromTable[tableName] || [];
  const fkFieldNames = new Set(fks.map((r) => r.fromField));

  const fields = t.fields
    .filter((f) => f.name !== 'tenantId' && !fkFieldNames.has(f.name))
    .map(fieldToStr);

  return {
    name: tableName,
    alias: t.alias || `[IMP] ${tableName}`,
    planned: (t.alias || '').includes('[PLAN-'),
    fields,
    fks: fks.map((r) => `${r.fromField} → ${r.toTable}`),
    indexes: (t.indexes || []).map(indexToStr),
    note: typeof t.note === 'string' ? t.note : '',
  };
}

const seenTables = new Set();
const MODULES = MODULE_DEFS.map((mod) => {
  mod.tables.forEach((t) => seenTables.add(t));
  const tableSet = new Set(mod.tables);
  // Solo relaciones donde la tabla HIJA (fromTable, la que tiene la FK) pertenece a este
  // módulo, para no duplicar la flecha en el módulo de la tabla padre.
  const mermaid = 'erDiagram\n' + allRefs
    .filter((r) => tableSet.has(r.fromTable))
    .map((r) => `  ${r.toTable} ||--o{ ${r.fromTable} : ${r.fromField}`)
    .join('\n');

  return {
    id: mod.id,
    name: mod.name,
    color: mod.color,
    bg: mod.bg,
    status: mod.status,
    phase: mod.phase,
    mermaid,
    cards: mod.tables.map(buildCard),
  };
});

const missing = schema.tables.map((t) => t.name).filter((n) => !seenTables.has(n));
if (missing.length) {
  console.warn(`AVISO: estas tablas están en vialto.dbml pero no en ningún módulo de este script (no van a aparecer en index.html): ${missing.join(', ')}`);
  console.warn('Agregalas al MODULE_DEFS de generate-html.js.');
}

const html = fs.readFileSync(HTML_PATH, 'utf8');
const modulesJson = JSON.stringify(MODULES);
const newHtml = html.replace(/const MODULES = \[[\s\S]*?\];\r?\n/, `const MODULES = ${modulesJson};\n`);
if (newHtml === html && !html.includes(modulesJson)) {
  throw new Error('No se encontró la línea "const MODULES = [...]" en el HTML — ¿se cambió la estructura del archivo?');
}
fs.writeFileSync(HTML_PATH, newHtml, 'utf8');

const unchanged = newHtml === html;
console.log(unchanged ? 'index.html ya estaba al día (sin cambios).' : 'index.html regenerado.');
console.log('Tablas por módulo:', MODULES.map((m) => `${m.id}:${m.cards.length}`).join(' '));
