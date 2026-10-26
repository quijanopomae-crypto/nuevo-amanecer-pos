---
name: add-migration
description: "Crear una migración de base de datos CANON/Turso: solo aditiva, con respaldo previo; el pedido del owner es la aprobación."
---

# Add migration

1. **Respaldo previo verificado, hecho por ti, antes de aplicar en remoto.** El pedido del owner que incluye la migración ya es la aprobación: no se la pidas otra vez. El respaldo, el Worker primero y la revisión independiente en riesgo ALTO son obligatorios y los haces tú, sin pedir OK. Pregunta solo si la migración sale del alcance pedido, borra datos de producción que no pidió expresamente (nunca se borran sin pedido expreso y respaldo), o falta un dato que solo él tiene.
2. Archivo nuevo `infra/database/migrations/00NN_descripcion.sql` con el siguiente número libre. Solo aditiva: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN` con default seguro, índices nuevos. Prohibido `DROP`, renombrar, reescribir o borrar datos, y tocar ventas/abonos pendientes.
3. El código del Worker debe funcionar con y sin la migración (comprobar el esquema, como `cash-session-cashier.js`). El Worker se publica primero y la migración (y la web) después; todo cambio con migración es riesgo ALTO: revisión independiente, humana o automatizada.
4. Pruebas: test de migración en `tests/cloud-sync/canon-migration-00NN.test.mjs` (aplica sobre SQLite en memoria, idempotente, sin pérdida de datos) siguiendo los existentes.
5. Activación remota: workflow `canon-migration-00NN.yml` + `ops/canon-migration-00NN.json`, siguiendo `canon-migrations-0021-0022.yml` o, desde el historial, el par de 0033 (`git show bf7d74db:.github/workflows/canon-migration-0033.yml` y `git show bf7d74db:ops/canon-migration-0033.json`), una vez hecho el respaldo y dentro del alcance pedido. Nunca uses los workflows prohibidos de `docs/codex/ARCHITECTURE.md`.
