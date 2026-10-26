# Política única de desarrollo y publicación

Vigente por misión explícita del propietario del 25/10/2026. Complementa AGENTS.md; ante contradicciones prevalece la solicitud actual del propietario. Codex, OpenCode y Grokbots aplican la misma política.

## Autorización y alcance

«Aprobado», «impleméntalo», «aplícalo a CANON», «corrígelo» o «continúa», vinculados a una implementación concreta, cubren desarrollo, pruebas, PR, integración y publicación de ese alcance. Registrar la solicitud y el alcance; no repetir consultas por cada paso técnico. Debatir o auditar sin permiso de escritura no autoriza producción. Datos reales, ampliaciones, secretos, borrados, force-push y cutover no se deducen de una autorización visual ni de una auditoría; solo están cubiertos cuando el pedido del dueño los nombra expresamente (el force-push nunca se cubre: siempre está prohibido).

**Regla del 25/10/2026 (dueño, en la sala: «mi pedido es la autorización, publiquen con respaldo sin preguntarme»):** el objetivo o pedido del dueño es la autorización de todo ese alcance, incluida la publicación al terminar. No se le pide OK por paso. El agente ejecuta solo los resguardos: respaldo verificado antes de migraciones o Worker, pruebas y CI, rollback listo, sin exponer secretos y sin tocar ventas ni abonos pendientes. Solo se vuelve a preguntar si (1) el cambio sale del alcance pedido, (2) es irreversible y no fue pedido expresamente (p. ej. borrar datos de producción: nunca se borran salvo que el dueño lo pida expresamente, con respaldo previo), o (3) falta un secreto o dato que solo el dueño tiene (lo pega él en su propio chat). En `--authorization` del manifiesto se cita ese pedido con su fecha.

Inicio, Venta y otras pantallas pueden rediseñarse cuando el propietario autoriza específicamente esa pantalla. No hay prohibición absoluta que invalide una decisión posterior.

## Riesgos y evidencia

| Riesgo | Superficie | Verificaciones y revisión |
|---|---|---|
| BAJO / low | CSS, textos, iconos, distribución sin lógica de datos | Diff, pruebas aplicables, preview del SHA en cambios visuales, autorrevisión documentada; PR, CI aplicable, merge y publicación dentro de autorización. Sin revisor externo obligatorio. |
| MEDIO / medium | Pantallas, navegación y asistentes que consumen una API autenticada existente sin cambiar sus controles ni operaciones críticas | Pruebas funcionales, denegaciones y seguridad, revisión técnica documentada. Puede realizarla el coordinador en una pasada explícita separada; segunda revisión automatizada cuando el alcance lo requiera. |
| ALTO / high | Ventas, pagos, crédito, caja, inventario, datos de clientes, autenticación/permisos, sincronización/outbox, migraciones, infraestructura de producción y cambios del gate de despliegue | Integridad, permisos, idempotencia, recuperación y regresión según superficie. Revisión técnica independiente reforzada, humana o automatizada; respaldo verificado por el agente cuando haya migración o riesgo de datos (no requiere OK adicional si el pedido cubre el cambio). Registrar SHA, autor/revisor, hallazgos y resolución. |

Usar el riesgo mayor del diff real. Presentar información privada o alterar el aislamiento de sesión eleva el análisis a ALTO. No afirmar que el revisor independiente existe porque se le envió una solicitud. Un agente que no responde se sustituye; la evidencia exigida permanece. No depende de nombres concretos ni de un humano indisponible.

Conservar default-deny, aislamiento de entornos, secretos fuera de Git, validaciones, pruebas negativas y pendientes recuperables. Nunca modificar datos de negocio para probar ni debilitar assertions para obtener verde. Un fallo se diagnostica y aísla; no paraliza cambios independientes seguros.

## Publicación web con un manifiesto

Un deploy publica todo el árbol POS del target, no solo el último PR. Antes de preparar la publicación, comparar el **SHA observado en producción** con el target y revisar todos los commits y archivos, incluidos eliminados. Si hay cambios ajenos al alcance pedido, no incorporarlos por conveniencia: aislarlos o resolver la dependencia.

1. Completar PR de código y CI. Leer el SHA de producción desde `/app/sw.js` o build-info. Guardar un JSON externo con la lista exacta de archivos revisados del diff producción..target **limitado a lo que se publica**: `POS/**`, `tools/cloudflare-pos-web/**`, `tools/release/**`, el workflow de deploy, el `package.json`/`package-lock.json` de `tools/cloudflare-lab` (wrangler fijado) y los 3 workflows de CI que definen los checks exigidos (`canon-critical-ci.yml`, `e2e-smoke-ci.yml`, `opencode-config-ci.yml`) (tests, docs y archivos fuera de esas rutas no cambian la web y no se listan; cualquier archivo publicado no listado sigue bloqueando). Las migraciones y el Worker de datos no se publican con este deploy: siguen su flujo propio (autorización del propietario + respaldo). El diff posterior a la revisión independiente se sigue comprobando completo, sin filtrar. `prepare` avisa (sin bloquear) de los archivos del diff que quedan fuera del alcance, y exige `--risk high` si el diff toca `tools/cloudflare-lab/`, `tools/cloudflare-prod/`, `tools/cloudflare-backup/`, `infra/database/migrations/`, `ops/canon-migration*` o cualquier `.sql`; un cambio solo de POS no se ve afectado.
2. Desde checkout limpio del target ejecutar:

```bash
node tools/release/web-release.mjs prepare --base SHA_PRODUCCION --target HEAD --rollback SHA_RECUPERABLE --scope /tmp/archivos-aprobados.json --authorization 'Referencia de autorización y alcance del propietario' --risk high --review-kind independent-automated --review docs/revision-del-candidato.json
```

La evidencia es un JSON versionado con `reviewed_commit` (SHA completo revisado), `kind`, `result: "pass"` y `reviewer`. Después del commit revisado solo puede agregarse/cambiar ese recibo; si cambia código, repetir la revisión real y generar otro recibo. El gate comprueba existencia, ancestro y diff; el coordinador contrasta identidad y resultado con la revisión realmente realizada.

3. El comando genera un único archivo `ops/v1.3-pos-web-deploy-trigger.json`. Crear rama/PR solo con ese manifiesto; no cambiar otros flags. Al merge se dispara el workflow existente. El guard verifica ancestros, diferencia completa y que entre target y HEAD solo cambie el manifiesto. Cualquier nuevo código posterior exige otro candidato; nunca se publica HEAD por accidente.
4. El gate exige CANON Critical CI, E2E Smoke CI y OpenCode Role Map CI SUCCESS en el target exacto; los fallos de otros workflows se diagnostican y documentan por alcance, sin convertir una comprobación no relacionada en bloqueo universal. Se requiere token de Actions de solo lectura; errores de API no cuentan como verde. Si un check no aplica, ejecutar una verificación real para ese target; no fabricar estados success.
5. El workflow conserva la lista de despliegues Cloudflare anterior y manifiesto en artifact, ejecuta dry-run, publica y verifica health/assets/hash. Sin cambios de secretos, backend, migraciones ni cutover implícitos. Backend primero cuando cambie, en su flujo específico.

El JSON histórico v1 se conserva como evidencia del despliegue 204, pero no satisface el gate nuevo. `workflow_dispatch` tampoco evita el guard. El manifiesto registra evidencia; no prueba por sí solo que el propietario o un revisor hayan evaluado los archivos: el coordinador debe contrastarlos con la solicitud y revisión real.

## Recuperación

Antes de publicar guardar el artifact con la versión Cloudflare anterior. Si falla la verificación, no anunciar éxito. El coordinador usa `wrangler rollback VERSION_ID --config ../cloudflare-pos-web/wrangler.jsonc` con la versión recuperable registrada, comprueba health y hash anterior, y registra el incidente. No migrar/restaurar datos por un fallo visual. El SHA rollback permite reconstruir la versión si ya no hay versión disponible; se revisa el manifiesto de recuperación y sus pruebas, sin reutilizar CI de otro SHA.

La integración GitHub puede no permitir configurar auto-merge o Branch Protection aunque el usuario tenga admin: distinguir privilegios de cuenta y capacidades del conector. Este flujo automatiza preparación, guard, deploy y probes; el coordinador efectúa PR y merge bajo autorización vigente con las herramientas disponibles. No prometer auto-merge nativo habilitado si no lo está.
