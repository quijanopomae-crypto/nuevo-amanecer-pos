# PIN persistente y ampliación de línea sin historial previo

Solicitud: conservar el PIN de seguridad al recargar y acelerar la ampliación de línea. Base: `955b07c`; esta corrección no incluye el parche de animaciones de PR #227.

Alcance: `POS/js/legacy-inline/inline-02.js`, `POS/js/sync/canonical-client.js`, `POS/js/sync/canonical-customer-credit-policy-bridge.js`, pruebas de seguridad/política y verificador local de navegador. Sin cambios de backend, esquema, datos comerciales ni autenticación de servidor.

La configuración de seguridad se guarda y verifica en su clave local propia. En CANON ese guardado no intenta persistir una copia comercial legacy. Durante la carga inicial, una configuración de seguridad local existente prevalece sobre el campo antiguo de un snapshot; una restauración explícita mantiene su comportamiento de aplicar la seguridad importada. Si falla la escritura del PIN no se anuncia éxito.

La ampliación usa la proyección validada o parcheada por recibos y envía un solo POST. Si la vista no está validada debe actualizarse primero. CANON mantiene autoridad y CAS de revisión de política dentro de la transacción. Los reintentos pendientes conservan consulta remota, misma operación y validación del recibo. La ficha se actualiza al confirmar el POST; el historial se concilia en segundo plano.

Validar: PIN con snapshot antiguo y recarga real; fallo de almacenamiento sin éxito falso; restauración explícita; historial bloqueado sin impedir ampliaciones; conflictos entre escritores, pérdida de ACK y regresión cloud-sync. No equivaler tiempos de fixtures con tiempo real del teléfono.

Rollback: publicar frontend anterior `008627a8-39b5-4f8f-8cc6-47ecdc0e712c`. Se conserva el backend y las mejoras financieras previas.

Verificación: 492 pruebas cloud-sync/seguridad aprobadas; 15 pruebas focalizadas aprobadas, incluyendo dos ampliaciones con historial bloqueado; Chrome confirmó PIN persistente tras recarga y bloqueo/desbloqueo. El comando nuevo empieza por POST, sin GET previo. `git diff --check` aprobado.

La suite histórica PWA adicional presenta dos fallos fuera del parche: expectativas antiguas de precache y allowlist de reader (52 frente a 104 assets ya presentes). `POS/sw.js`, la suite PWA y el builder reader no cambian en esta corrección. El frontend publicado usa hash de build y precache vigente.
