// (22-10) Publicación en CANON: claves del asistente solo como secretos del Worker (por stdin, nunca impresas); base URL y modelo en vars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveProvider, configFor } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
const CFG = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-prod.jsonc', 'utf8'));

test('nombres de secreto: ASSISTANT_AI_API_KEY_4 = OhMyAgent, ASSISTANT_AI_API_KEY_2 = Routeway (respaldo)', () => {
  const c = resolveProvider({ ASSISTANT_AI_API_KEY_4: 'k4', ASSISTANT_AI_API_KEY_2: 'k2' });
  assert.deepEqual([c.id, c.model, c.key, c.vision], ['ohmyagent', 'gpt-6.1-sol', 'k4', true]);
  assert.deepEqual(c.fallbacks.map((f) => [f.id, f.model, f.key]), [['routeway', 'gemma-4-26b-a4b-it-luminous:free', 'k2'], ['routeway', 'minimax-m2.7:free', 'k2']]);
  assert.equal(configFor({ ASSISTANT_AI_API_KEY_2: 'k2' }, 'routeway').key, 'k2');
  // con las vars de CANON (sin secretos aquí)
  const v = resolveProvider({ ...CFG.vars, ASSISTANT_AI_API_KEY_4: 'k4', ASSISTANT_AI_API_KEY_2: 'k2' });
  assert.deepEqual([v.id, v.base, v.model, v.key], ['ohmyagent', 'https://ohhmyagent.com/v1', 'gpt-6.1-sol', 'k4']); assert.equal(v.fallbacks[0].key, 'k2');
});

test('CANON: vars sin secretos (bandera, proveedor, base URL, modelo); las claves no están en la config', () => {
  assert.equal(CFG.vars.ASSISTANT_ENABLED, '1'); assert.equal(CFG.vars.AI_PROVIDER, 'ohmyagent'); assert.equal(CFG.vars.AI_BASE_URL, 'https://ohhmyagent.com/v1'); assert.equal(CFG.vars.AI_MODEL, 'gpt-6.1-sol');
  assert.ok(!Object.keys(CFG.vars).some((k) => /KEY|SECRET|TOKEN/.test(k)));
  assert.equal(CFG.vars.ASSISTANT_OWNER_BOOTSTRAP, undefined, 'el registro de aparato dueño sigue apagado (necesita la migración 0036)');
});

