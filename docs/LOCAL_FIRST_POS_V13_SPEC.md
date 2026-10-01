# Especificación aprobada: local-first V1.3

Fuente: PDF y prompt del propietario. Implementación autorizada; merge/deploy no autorizados.

```text
 NUEVO AMANECER POS V1.3 - ESPECIFICACIÓN PARA CODEX



                 Implementación Local-First
              con respaldo y recuperación Cloud
 Eliminar la dependencia de la nube del camino crítico sin sacrificar integridad,
 idempotencia ni recuperación.

    DECISIÓN: El dispositivo writer trabaja primero con persistencia local durable. La nube replica en segundo
    plano y funciona como segunda copia y recuperación.



    REGLA CLAVE: "Sin colas" no significa eliminar el ledger/outbox interno. Significa que ninguna cola de
    sincronización bloquea al cajero ni el arranque.




 Repositorio: quijanopomae-crypto/nuevo-amanecer-pos

 Rama base: feature/v1.3-mobile-cloud

 HEAD observado antes de generar este documento: f865ae53a3330ed9cbf71fe9141f64a3fc0ac165
 (Codex debe verificar el HEAD real al comenzar).



 Este documento no autoriza deploy, cutover, ventas reales, borrado de datos ni restauraciones destructivas en producción.




Nuevo Amanecer POS V1.3 - Local-First                                                                                        Página 1
 Diagrama objetivo

           Usuario                      →   Commit local durable                →    UI actualizada




           Ledger local                 →   Sync background                     →    Cloud backup / ACK




 Camino visible: no espera Worker/Turso. Camino de respaldo: ocurre después del commit local.


 Resumen ejecutivo
 Nuevo Amanecer POS V1.3 debe convertirse en un sistema local-first de un solo writer. El dispositivo de caja
 confirma primero en almacenamiento local durable, actualiza la interfaz de inmediato y replica a la nube en segundo
 plano. La nube deja de ser requisito para vender o cobrar y pasa a ser copia remota, recuperación y auditoría.

 No se elimina la durabilidad ni la idempotencia. La frase "sin colas" se interpreta como "sin cola bloqueante para el
 usuario". Debe existir un ledger/outbox interno para reintentos, causalidad y recuperación, pero nunca como requisito
 visible para seguir trabajando.


 Base verificada del repositorio
 Rama de referencia: feature/v1.3-mobile-cloud. En la inspección previa, HEAD era
 f865ae53a3330ed9cbf71fe9141f64a3fc0ac165. Codex debe volver a verificar HEAD real antes de escribir.

 El repositorio ya contiene piezas aprovechables: canonical-client.js, canonical-sale-outbox.js,
 canonical-credit-payment-bridge.js, canonical-cash-bridge.js, hosted-canonical-guard.js, canonical-ui-adapter.js,
 state.js, service worker, tests/cloud-sync y el contrato V1.3 A4 de outbox offline.

 A4 ya establece el principio correcto: persistir localmente antes del envío, conservar operation_id estable, sobrevivir
 reload/offline y evitar duplicados. La implementación solicitada extiende ese principio a todas las mutaciones
 comerciales y elimina el journal financiero global como bloqueo transversal.


 Síntomas que esta implementación debe eliminar
 1) Cierre de caja rechazado con INVALID_CANONICAL_CASH_SESSION cuando el estado remoto y el estado
 visible/local no coinciden.

 2) Una sale.create pendiente puede impedir cambios posteriores, por ejemplo ajustes de línea de crédito.

 3) Una operación CANON pendiente puede impedir iniciar un cobro múltiple.

 4) El usuario puede ver módulos con información desfasada o vacía mientras otros conservan movimientos, señal de
 que la lectura operacional no está unificada.

 5) El arranque y algunas mutaciones todavía pueden quedar condicionados por refresh, ACK o snapshot remoto.


 Principio de diseño
 La UI debe depender de una transacción local durable, no de la latencia de Worker/Turso. La red puede fallar
 durante minutos sin impedir ventas, cobros, caja, gastos o navegación. Cada operación debe poder reconstruirse,
 reenviarse con el mismo identificador y reconciliarse sin aplicar efectos dos veces.

 El modelo continúa siendo single-writer. No se introducen CRDT, multiwriter, WebSockets ni consenso distribuido.
 Esto permite una arquitectura pequeña, predecible y compatible con el principio del repositorio: simplificar antes de
 añadir capas.




Nuevo Amanecer POS V1.3 - Local-First                                                                              Página 2
 Arquitectura objetivo
 Camino visible: USUARIO -> VALIDACIÓN LOCAL -> COMMIT LOCAL DURABLE -> PROYECCIÓN/UI -> FIN.

 Camino de respaldo: COMMIT LOCAL -> LEDGER/OUTBOX DURABLE -> SINCRONIZADOR BACKGROUND ->
 WORKER/TURSO -> ACK -> marcar SYNCED.

 Camino de recuperación: LOCAL <-> comparador de baseline/revisión/digest/secuencia <-> CLOUD. Cualquier
 restauración destructiva requiere confirmación explícita del propietario.


 Almacenamiento local
 Codex debe inspeccionar primero el motor real de persistencia (incluyendo IndexedDB/persistence v10 si continúa
 vigente) y reutilizarlo. No crear una base paralela simplemente por comodidad.

 Se requiere un baseline local versionado y un ledger de operaciones. El baseline representa una réplica CANON
 validada en el momento de activar local-first. Cada mutación posterior queda representada por un evento durable.

 Cada evento necesita operation_id, comando, payload normalizado, payload_hash, created_at, secuencia
 monotónica, estado de replicación, intentos, error, dependencias causales y referencia a baseline/revisión. No incluir
 tokens, PIN ni secretos.

 Estados sugeridos: LOCAL_COMMITTED, SYNCING, SYNCED, REJECTED y CONFLICT. Se pueden adaptar a
 nombres ya existentes si preservan la semántica.


 Commit local atómico
 Para una venta, pago, cierre o ajuste, el éxito visible ocurre únicamente después de que la proyección local y el
 evento durable hayan quedado guardados de forma atómica o con una garantía equivalente.

 Después de ese punto el POS cierra el modal, actualiza KPIs/saldos/stock/caja y permite la siguiente operación. El
 proceso cloud se desacopla completamente del camino crítico.

 Si la escritura local falla por cuota, corrupción o almacenamiento no durable, la operación no se muestra como
 completada. Ese fallo sí es bloqueante porque implica riesgo real de pérdida.


 Orden causal interno
 Eliminar el bloqueo global no significa enviar eventos en cualquier orden. El replicador debe respetar dependencias
 por recurso.

 Caja: cash.open -> ventas/pagos/gastos de esa sesión -> cash.close. Cliente/crédito: customer.create ->
 credit-account.create -> venta a crédito -> payment. Inventario: product.create -> venta o inventory.adjust. La UI no
 espera este envío, pero el replicador sí conserva ese orden.

 La serialización debe ser por recurso/dependencia, no un candado global para todas las operaciones financieras.


 Arranque local-first
 Con almacenamiento local válido: cargar local, montar UI, habilitar operación local y recién después comprobar nube
 en background.

 Con almacenamiento local inexistente: bootstrap desde cloud, validar esquema/digest, persistir baseline y luego
 habilitar mutaciones.

 Con cloud lenta o caída y local válido: seguir operando. El estado visual debe indicar "Sin conexión - trabajando
 local" en vez de bloquear.


 Cobertura funcional
 La arquitectura debe cubrir como mínimo sale.create, payment.create, payment.batch, cash.open, cash.close,
 expense.create, inventory.adjust, customer.create, customer.credit-policy.set, credit-account.create y product.create


Nuevo Amanecer POS V1.3 - Local-First                                                                             Página 3
 cuando forme parte del CANON actual.

 También debe abarcar cualquier comando administrativo que use el journal financiero global y que hoy pueda
 impedir una operación posterior no relacionada.


 Venta e inventario
 La venta debe aplicar una sola vez los efectos locales de venta, stock y caja/crédito. El retry cloud conserva el mismo
 operation_id y nunca vuelve a descontar stock local.

 La venta aparece inmediatamente en historial/KPIs desde la proyección local. Cuando llega el ACK cloud solo
 cambia el estado de respaldo; no aparece una segunda venta.


 Pagos y créditos
 El pago valida contra saldo local vigente, registra el evento y actualiza la deuda local inmediatamente. Pago múltiple
 no puede bloquearse por una sale.create cloud pendiente no relacionada.

 La protección de referencias de Yape/transferencia, saldos, cuotas y operation_id debe conservarse. Lost ACK
 significa replay del mismo evento, nunca crear otro.


 Caja
 La sesión operacional de caja debe ser la sesión local vigente. El error INVALID_CANONICAL_CASH_SESSION se
 resuelve eliminando la dependencia de un snapshot cloud atrasado en el camino visible.

 El cierre local usa todos los movimientos locales de la sesión, incluidos los todavía no replicados. El sincronizador no
 puede enviar cash.close al cloud antes de las operaciones previas de esa sesión.


 Contrato cloud como réplica
 Primera opción: reutilizar /commands/* solo si el código demuestra que puede aceptar el flujo local idempotente sin
 convertir una revisión cloud atrasada en rechazo de una operación local válida.

 Si el contrato actual no permite local-first real, Codex debe demostrar la incompatibilidad y añadir el contrato mínimo
 de replicación. Un push por lote puede incluir operation_id, secuencia y hash; debe ser idempotente, detectar
 huecos, rechazar hash conflictivo y aplicar proyecciones en una transacción.

 No relajar validaciones ni abrir endpoints destructivos. Recovery debe tener autorización owner y pruebas
 exclusivamente en entorno de prueba.


 Backups y checkpoints
 Mantener checkpoints locales versionados con digest, timestamp y secuencia cubierta. Solicitar almacenamiento
 persistente del navegador cuando sea apropiado.

 Un backup dentro del mismo origen protege contra corrupción lógica, no contra "Borrar datos del sitio" ni pérdida
 física del teléfono. La copia cloud es la protección frente a esas pérdidas.


 Detección de pérdida cloud
 Nunca concluir pérdida solo por cantidad de registros. Comparar promotion/authority epoch, revisión, secuencia alta
 conocida, baseline/digest, operation_ids y ACKs.

 Si cloud aparece vacío, retrocedido o incompatible mientras local conserva una cadena coherente más nueva:
 detener cualquier sincronización destructiva, conservar local y mostrar CLOUD_RECOVERY_REQUIRED.

 Ventana requerida: "Se detectó pérdida o retroceso en la copia de la nube. La información local de este equipo es
 más completa. No se modificará nada automáticamente. ¿Deseas restaurar la nube usando el respaldo local?"




Nuevo Amanecer POS V1.3 - Local-First                                                                             Página 4
 Restauración local -> cloud
 Nunca automática. Validar integridad local, obtener confirmación explícita, crear respaldo previo cuando sea posible,
 restaurar transaccionalmente o mediante replay idempotente y verificar digest/revisión final.

 No probar restauración destructiva contra producción. Si hace falta una ruta recovery nueva, debe implementarse
 con autorización owner y cobertura de seguridad.


 Restauración cloud -> local
 Si local falta o está corrupto y cloud es válido, descargar snapshot, validar, escribir una nueva base local sin destruir
 inmediatamente la anterior y activar la nueva solo después de la validación.


 Conflictos
 same operation_id + mismo payload_hash = idempotente. same operation_id + hash distinto = CONFLICT. sequence
 gap = esperar/solicitar faltantes. cloud detrás = push. local detrás y sin cambios nuevos = pull seguro. divergencia
 real en ambos lados = revisión manual, nunca "último timestamp gana".


 Migración desde V1.3 actual
 No borrar datos existentes. Crear baseline local desde una réplica CANON válida, importar/normalizar pending
 existentes, preservar operation_id y clasificar cualquier estado ambiguo como NEEDS_REVIEW/CONFLICT.

 La migración debe tener rollback y prueba de que ventas, pagos, stock y caja no se duplican.


 UI y experiencia
 El estado normal debe ser discreto: Guardado local, Sincronizando, Respaldo cloud actualizado, Sin conexión -
 trabajando local, o Conflicto requiere revisión.

 Eliminar mensajes que obliguen al cajero a "resolver otra operación CANON pendiente" cuando no exista conflicto
 real. Navegación, scroll, animaciones y responsive deben permanecer intactos.


 Secuencia de implementación recomendada
 Fase 0: proteger estado, mapear persistencia y dependencias. Fase 1: baseline + ledger local + migración. Fase 2:
 bootstrap local-first. Fase 3: ventas. Fase 4: pagos/créditos. Fase 5: caja. Fase 6:
 gastos/clientes/inventario/productos. Fase 7: sincronizador/causalidad. Fase 8: recovery cloud/local. Fase 9:
 regresiones, métricas y PR.

 Codex puede hacer varios commits reversibles, pero debe mantener un único writer de código y revisar el diff
 después de cada bloque.


 Matriz mínima de pruebas
 BOOT: local+cloud lenta; local+offline; local vacía+cloud; reload. VENTA: offline, doble venta antes de ACK, lost
 ACK, cero duplicados, stock/caja una vez. PAGOS: offline, batch, referencia duplicada, efectivo, lost ACK. CAJA:
 open/movimientos/close offline y sync causal. RECOVERY: cloud detrás/vacío, cancelar restore, restore en test, local
 corrupto, conflicto.

 RESILIENCIA: cierre del navegador, crash, dos pestañas, storage failure, timeout/5xx/401/403, reload durante sync y
 update de service worker. SEGURIDAD: sin tokens en backup, recovery autorizado, no endpoint destructivo abierto,
 inputs validados.


 Criterios de aceptación
 PASS solo si: el arranque con local válido no espera cloud; venta/pago/caja confirman tras commit local; pending
 cloud no bloquea operaciones no conflictivas; offline funciona; reload conserva; retries no duplican; causalidad se


Nuevo Amanecer POS V1.3 - Local-First                                                                               Página 5
 respeta; cloud se actualiza en background; cloud atrasado no sobrescribe local; recovery exige confirmación; local
 puede restaurarse desde cloud; P0=0 y P1=0.


 Prohibiciones
 No reset/clean/force push. No borrar IndexedDB/localStorage del usuario para destrabar. No desactivar
 idempotencia. No cambiar operation_id en retries. No usar timeouts como parche. No refresh global por cada
 operación. No polling agresivo. No auto-restore cloud. No pruebas destructivas en producción. No tocar secrets. No
 ventas reales. No deploy/cutover/merge final sin autorización.


 Entrega de Codex
 Debe dejar commits pequeños, pruebas ejecutadas con comando+resultado, métricas antes/después, riesgos,
 rollback, PR hacia feature/v1.3-mobile-cloud y lista de pruebas físicas Android pendientes.

 No declarar éxito porque "la nube respondió rápido". El éxito es que la UI dejó de depender de la respuesta cloud.




Nuevo Amanecer POS V1.3 - Local-First                                                                           Página 6
 Archivos y contratos a inspeccionar primero
      Área                   Rutas principales                                     Objetivo

      Cliente CANON          POS/js/sync/canonical-client.js                       Eliminar journal global bloqueante; preservar
                                                                                   validación e idempotencia.

      Ventas                 canonical-sale-outbox.js                              Commit local + réplica cloud.
                             canonical-sale-integration.js
                             canonical-sale-view.js

      Pagos                  canonical-credit-payment-bridge.js                    Saldo/proyección local inmediata; sync posterior.

      Caja                   canonical-cash-bridge.js                              Sesión local vigente + causalidad en réplica.

      Estado/persistencia    POS/js/core/state.js                                  Baseline, ledger, checkpoints y migración.
                             motor IndexedDB/persistence real

      Shell                  POS/sw.js                                             Precarga módulos y modal recovery si aplica.
                             POS/index.html

      Pruebas                tests/cloud-sync/**                                   Offline, no bloqueo, idempotencia y recovery.
                             persistencia/caja/stock/créditos




 Contrato de ejecución para Codex
 Primero analizar, después escribir. Leer README.md, AGENTS.md, AGENTS_Nuevo_Amanecer.md,
 docs/V1.3_A4_OFFLINE_OUTBOX.md y las skills impact-analysis, cross-module-impact, inventory-integrity,
 cash-integrity y canon-promotion.

 Crear una rama dedicada desde el HEAD real, realizar commits pequeños y reversibles, ejecutar pruebas focalizadas
 después de cada bloque y revisar el diff antes de avanzar.

 Continuar automáticamente entre fases salvo bloqueo real: secreto requerido, contradicción de negocio,
 migración/borrado irreversible o acción destructiva sobre producción.


 Resultado final esperado

    El POS debe poder abrir, vender, cobrar, operar caja y registrar cambios con la nube lenta o caída. La
    información queda durable localmente y se replica después. Si la nube retrocede o se vacía, el local nunca es
    sobrescrito en silencio; el propietario recibe una ventana de recuperación. Si el local se pierde, la nube puede
    reconstruirlo.



 La unidad de éxito no es la velocidad de una petición HTTP. La unidad de éxito es que la operación comercial dejó de depender de esa
 petición.




Nuevo Amanecer POS V1.3 - Local-First                                                                                                  Página 7

```
