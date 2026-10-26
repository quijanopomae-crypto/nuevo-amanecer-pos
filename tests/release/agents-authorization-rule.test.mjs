import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('AGENTS.md es corto y declara que el pedido del dueño es la autorización del alcance', () => {
  const s = read('AGENTS.md');
  assert.ok(s.trimEnd().split('\n').length <= 45);
  assert.match(s, /objetivo o pedido del dueño es la autorización de todo ese alcance/);
  assert.match(s, /publicación al terminar/);
  assert.match(s, /respaldo, pruebas y rollback/);
});

test('se conservan los resguardos obligatorios (respaldo, rollback, migraciones aditivas, revisión independiente en ALTO, force-push prohibido)', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /respaldo previo de la BD/i);
  assert.match(agents, /Worker se publica primero/);
  assert.match(agents, /rollback_ref/);
  assert.match(agents, /revisión independiente en riesgo ALTO/);
  assert.match(agents, /Force-push: siempre prohibido/);
  assert.match(agents, /migraciones solo aditivas/);
  assert.match(agents, /nunca borrar datos de producción/);

  const mig = read('.agents/skills/add-migration/SKILL.md');
  assert.match(mig, /Respaldo previo verificado/);
  assert.match(mig, /Solo aditiva/);
  assert.match(mig, /Worker se publica primero/);
  assert.match(mig, /revisión independiente/);

  const pre = read('.agents/skills/pre-publish-verification/SKILL.md');
  assert.match(pre, /respaldo de BD/i);
  assert.match(pre, /rollback_ref/);
  assert.match(pre, /3 CI exactos/);
  assert.match(pre, /revisión independiente/);
  assert.match(pre, /force-push siempre prohibido/);

  const policy = read('docs/DEVELOPMENT_RISK_POLICY.md');
  assert.match(policy, /falta un secreto o dato que solo el dueño tiene/);
  assert.match(policy, /force-push nunca se cubre: siempre está prohibido/);
  assert.match(read('docs/BRANCH_PREVIEW_WORKFLOW.md'), /force-push está siempre prohibido/);
});
