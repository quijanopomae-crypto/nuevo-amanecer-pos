export function normalizeDatabaseBinding(env) {
  const db = env?.DB ?? env?.nuevo_amanecer_lab;
  if (!db || env?.nuevo_amanecer_lab === db) return env;
  return { ...env, nuevo_amanecer_lab: db };
}
