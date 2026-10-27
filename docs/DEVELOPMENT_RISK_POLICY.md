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

## Publicación web DIRECTA: un flujo, sin PR ni manifiesto adicional

Una orden explícita del propietario autoriza desarrollar, integrar y publicar **solo su alcance**. Al recibir un push en CANON, AUTO-DEV CI realiza validación de contratos, regresiones comerciales y navegador; solo después su trabajo `publish-web` puede ejecutar `verify-direct`. El dueño no administra CI ni manifiestos.

- **BAJO:** CSS y recursos visuales seguros de `POS/` se publican automáticamente. El guard compara el SHA real publicado con el HEAD de CANON y el diff **completo** entre ambos; si solo hay cambios administrativos antiguos, no publica una versión innecesaria.
- **MEDIO (WORK UI aislada):** HTML, CSS, puente `POS/work/work-canon-bridge.js` y `POS/js/work-host.js`. AUTO-DEV ejecuta pruebas de WORK, permisos y navegador; el agente registra en el commit el alcance exacto, sin pedir recibos ni formularios al propietario. Solo el arranque visual de `POS/index.html` aprobado en #1088 puede pasar mediante su blob fijado; cualquier otro cambio a `POS/index.html` queda fuera del despliegue directo.
- **ALTO o desconocido:** ventas, caja, inventario, crédito, pagos, permisos, sincronización, autenticación, Worker, SQL y otras rutas sensibles **no** se autopublican con esta vía. Necesitan revisión independiente y respaldos reales antes de habilitar una ruta de despliegue de alto riesgo. Nunca se inventa una aprobación.

El agente registra en el último commit de cada misión futura de WORK `NA-Direct: true`, `NA-Mission: orden aprobada`, `NA-Paths: ["POS/work/index.html"]` (lista completa de cambios web pendientes desde el SHA realmente publicado) y `NA-Review-Kind: auto-ci`. AUTO-DEV verifica el alcance y CI completo del commit antes de desplegar. No se admite una lista parcial ni un archivo borrado. La publicación inicial ya aprobada del #1088 puede ejecutarse sin esos metadatos únicamente si ningún archivo `POS/` cambió después del commit de integración. Para la ruta manual histórica con `NA-Review-Kind: technical` continúa siendo obligatorio un recibo de revisión real; no inventar evidencias.

El workflow registra el despliegue previo, verifica archivos y health, compara SHA de Service Worker y revierte automáticamente la web con Wrangler si falla la comprobación pública posterior al deploy. No restaura datos de negocio antiguos.

El antiguo `v1.3-pos-web-deploy.yml` queda únicamente con `workflow_dispatch` como vía manual excepcional, sujeta a su gate de seguridad. Ya no se dispara en push ni al finalizar CI y **no** forma parte del procedimiento rutinario. Se eliminará cuando la alternativa haya demostrado recuperación correcta.

## Recuperación

Antes de publicar, conservar el despliegue anterior de Cloudflare. Si falla la comprobación pública, AUTO-DEV ejecuta `wrangler rollback --message ...` y verifica health; se informa el fallo original aunque la reversión resulte correcta. Si el rollback automático falla, se requiere recuperación manual de la versión registrada. No migrar/restaurar datos por un fallo visual. El SHA rollback permite reconstruir la versión si ya no hay versión disponible; se revisa el manifiesto de recuperación y sus pruebas, sin reutilizar CI de otro SHA.

La integración GitHub puede no permitir configurar auto-merge o Branch Protection aunque el usuario tenga admin: distinguir privilegios de cuenta y capacidades del conector. Este flujo automatiza preparación, guard, deploy y probes; el coordinador efectúa PR y merge bajo autorización vigente con las herramientas disponibles. No prometer auto-merge nativo habilitado si no lo está.
