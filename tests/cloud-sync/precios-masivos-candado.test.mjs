// Candado 'edicion-masiva-precios' (#901): falla cerrado, sin tocar ownerAllowed().
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('POS/js/modules/precios-masivos.js', 'utf8');
class N { constructor(t) { this.tagName = t; this.children = []; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.className = ''; }
  addEventListener() {} closest() { return null; }
  replaceChildren(...c) { this.children = c; } appendChild(c) { this.children.push(c); return c; } append(...c) { this.children.push(...c); } setAttribute() {} }
function load(perms, { owner = true } = {}) {
  const sel = { '[data-pm-main]': new N('div'), '[data-pm-status]': new N('p'), '[data-pm-content]': new N('div'), '[data-pm-apply]': new N('button'),
    '[data-pm-category]': new N('select'), '[data-pm-mode]': new N('select'), '[data-pm-value]': new N('input') };
  sel['[data-pm-mode]'].value = 'porcentaje'; sel['[data-pm-value]'].value = '10';
  const page = { querySelector: s => sel[s], addEventListener() {}, classList: { contains: () => false } };
  const ctx = { document: { readyState: 'complete', getElementById: id => id === 'pageEdicionPrecios' ? page : null, createElement: t => new N(t) },
    addEventListener() {}, NA_ROLES: { isOwner: () => owner }, productos: [{ id: 'p1', nombre: 'Arroz', cat: 'A', precio: 10 }], calls: [] };
  ctx.saveAllData = async () => { ctx.calls.push('save'); return true; };
  if (perms !== undefined) ctx.NA_PERMISSIONS = perms;
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { api: ctx.NA_PRECIOS_MASIVOS, sel, ctx };
}
const base = { canAccessScreen: () => true };
const variants = {
  closed: { ...base, featureLocked: () => true },
  sinFuncion: { ...base },
  undefinedResult: { ...base, featureLocked: () => undefined },
  error: { ...base, featureLocked() { throw new Error('x'); } },
};
test('candado ausente (sin NA_PERMISSIONS): cerrado', () => {
  const { api, sel } = load(undefined);
  assert.equal(api.unlocked(), false); assert.equal(api.render(), false); assert.equal(sel['[data-pm-main]'].hidden, true);
});
for (const [name, perms] of Object.entries(variants)) test(`candado ${name}: oculta controles, no prepara plan ni aplica`, async () => {
  const { api, sel, ctx } = load(perms);
  assert.equal(api.unlocked(), false);
  assert.equal(api.render(), false);
  assert.equal(sel['[data-pm-main]'].hidden, true); assert.equal(sel['[data-pm-apply]'].disabled, true);
  assert.equal(sel['[data-pm-content]'].children.length, 0);
  assert.equal(sel['[data-pm-status]'].textContent, 'Disponible pronto.');
  assert.equal(await api.apply(), null); assert.deepEqual(ctx.calls, []);
  assert.equal(ctx.productos[0].precio, 10);
});
test('candado real en pos-permissions.js: abierto (OK dueño 2026-10-23); cerrado de nuevo vuelve a ocultar', () => {
  const c = vm.createContext({}); vm.runInContext(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), c);
  assert.equal(c.NA_PERMISSIONS.featureLocked('edicion-masiva-precios'), false);
  assert.equal(load({ ...base, featureLocked: () => true }).api.unlocked(), false);
});
test('candado abierto: muestra vista previa (dueño)', () => {
  const { api, sel } = load({ ...base, featureLocked: id => id !== 'edicion-masiva-precios' });
  assert.equal(api.unlocked(), true); assert.equal(api.render(), true);
  assert.equal(sel['[data-pm-main]'].hidden, false); assert.equal(sel['[data-pm-apply]'].disabled, false);
});
test('candado abierto pero empleado: sigue sin permiso (allowed() intacto)', () => {
  const { api, sel } = load({ ...base, featureLocked: () => false }, { owner: false });
  assert.equal(api.render(), false); assert.match(sel['[data-pm-status]'].textContent, /Sin permiso/);
});
