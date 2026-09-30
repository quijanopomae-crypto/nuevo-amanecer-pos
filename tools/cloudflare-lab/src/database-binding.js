import { createTursoD1Adapter } from './turso-d1-adapter.js';

const tursoCache = new WeakMap();

function tursoDatabase(env) {
  if (!env || typeof env !== 'object') throw new Error('Worker env is required');
  let database = tursoCache.get(env);
  if (!database) {
    database = createTursoD1Adapter(env);
    tursoCache.set(env, database);
  }
  return database;
}

export function getDatabase(env) {
  if (String(env?.DB_PROVIDER || '').trim().toLowerCase() === 'turso') return tursoDatabase(env);
  return env?.DB ?? env?.nuevo_amanecer_lab;
}

export function normalizeDatabaseBinding(env) {
  const db = getDatabase(env);
  if (!db || env?.DB === db) return env;
  return { ...env, DB: db };
}
