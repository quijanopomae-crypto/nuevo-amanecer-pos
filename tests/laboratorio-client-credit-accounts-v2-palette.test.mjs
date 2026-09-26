import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('laboratorio/pos-lab/styles/pages/clientes.css', 'utf8');

test('V2 financial profile uses a neutral surface system with Nuevo Amanecer teal as brand', () => {
  assert.match(css, /--lab-v2-brand:#0f766e/);
  assert.match(css, /--lab-v2-surface:#fff/);
  assert.match(css, /--lab-v2-surface-soft:#f7f9fa/);
  assert.match(css, /--lab-v2-border:#e1e7eb/);
  assert.match(css, /\.lab-client-account-screen\{[^}]*background:#f6f8f8/);
  assert.match(css, /\.lab-v2-client-head\{[^}]*background:var\(--lab-v2-surface,#fff\)/);
});

test('decorative blue and green section fills are neutralized', () => {
  assert.match(css, /\.lab-v2-tone-blue\{--lab-accent:var\(--lab-v2-brand/);
  assert.match(css, /\.lab-v2-tone-green\{--lab-accent:#64748b;--lab-soft:var\(--lab-v2-surface-soft/);
  assert.doesNotMatch(css, /\.lab-v2-line-hero\{[^}]*#eff6ff/);
  assert.doesNotMatch(css, /\.lab-v2-line-hero\{[^}]*#cfe0ff/);
  assert.match(css, /\.lab-v2-history-link \.lab-v2-module-icon\{[^}]*#475569/);
});

test('semantic financial states keep red amber green and teal meaning', () => {
  assert.match(css, /\.lab-v2-risk-red\{[^}]*#be123c/);
  assert.match(css, /\.lab-v2-risk-amber\{[^}]*#a16207/);
  assert.match(css, /\.lab-v2-risk-green\{[^}]*#15803d/);
  assert.match(css, /\.lab-v2-installment-overdue[^}]*\{[^}]*#fecdd3/);
  assert.match(css, /\.lab-v2-installment-today[^}]*\{[^}]*#f6d88b/);
  assert.match(css, /\.lab-v2-installment-paid[^}]*\{[^}]*#c8eed5/);
  assert.match(css, /\.lab-v2-installment\.is-next\{[^}]*#7dd3c7/);
});

test('palette polish does not alter responsive geometry or touch targets', () => {
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /\.lab-v2-risk\{[^}]*min-height:44px/);
  assert.match(css, /width:min\(100%,760px\)/);
  assert.match(css, /overflow-wrap:anywhere/);
});
