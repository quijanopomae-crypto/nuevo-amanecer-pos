export function getDatabase(env) {
  return env?.DB ?? env?.nuevo_amanecer_lab;
}

export function normalizeDatabaseBinding(env) {
  const db = getDatabase(env);
  if (!db || env?.DB === db) return env;
  return { ...env, DB: db };
}
