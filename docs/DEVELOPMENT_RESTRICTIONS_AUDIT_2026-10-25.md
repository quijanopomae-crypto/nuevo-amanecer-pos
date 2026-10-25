# Auditoría de restricciones — 25/10/2026

Base: CANON `70777d5b2f1789da18b9859d03b995dd228693d0`. Fuentes adjuntas leídas como contexto histórico; no sustituyen el HEAD actual. No se reimportó el ZIP antiguo.

## Restricciones comprobadas

| Origen | Tipo | Propósito / efecto | Resolución |
|---|---|---|---|
| AGENTS.md, docs/BRANCH_PREVIEW_WORKFLOW.md, pre-publish-verification | Markdown | Revisión nominal Reviewer/Forensic para integraciones agrupadas con operaciones críticas; puede esperar indefinidamente | Tres niveles y sustitución por revisión automatizada real; conservar evidencia. |
| AGENTS.md, BUSINESS_CONTEXT, add-screen | Markdown | Prohíben rediseño sin autorización específica; #1048 ya quitó prohibición absoluta | Conservar alcance por pantalla; autorización posterior explícita prevalece. |
| .agents/skills/canon-promotion/SKILL.md | Markdown obsoleto | Aún exigía CANDIDATO_A_CANON y pruebas LAB retirado | Sustituido por integración desde rama CANON; sin reactivar LAB. |
| AGENTS_Nuevo_Amanecer.md | Markdown | Detención por rediseño completo incluso autorizado | Acotar detención a rediseño fuera del alcance autorizado. |
| .opencode/agents/*.md | Permisos de OpenCode ejecutables | Subagente local no puede deploy, shell arbitrario ni tareas remotas; planner/reviewer/tester no escriben | Conservados; coordinador finaliza acciones autorizadas. No equivale a prohibición del propietario. |
| REPO_MAP.yaml / orquestador | Mapa y código SHADOW | SHADOW no gobierna tarea normal; LAB retirado; backend de nombre cloudflare-lab sí es CANON | Conservado, añadida política única. No borrar backend por nombre. |
| GitHub rulesets GET | Configuración remota | Respuesta [] | No había rulesets listados que eliminar. |
| GitHub branch GET | Configuración remota | protected=true; resumen required_status_checks enforcement_level=off, contexts=[] | No inferir ausencia de requisitos de revisión a partir de ese resumen. |
| GitHub Branch Protection detallada | Permiso real del conector | GET devuelve 403 Resource not accessible by integration | No se pudo auditar/editar detalle. Cuenta muestra admin, pero integración no tiene administración suficiente. |
| GitHub repository | Configuración remota | allow_auto_merge=false | No habilitado: conector no ofrece mutación de configuración del repositorio. PR/merge por coordinador autorizado sigue disponible. |
| CODEOWNERS | Archivo | No hay archivo tracked CODEOWNERS en árbol | No inventar aprobación obligatoria por CODEOWNERS. |
| 31 workflows .github/workflows | Ejecutable | Checks, deploys y migraciones con distintos triggers | Inventario más abajo. No ejecutar workflows históricos/cutover para acelerar publicación. |
| ops/v1.3-pos-web-deploy-trigger.json | Disparador versionado | Merge solo no publica; JSON histórico Web 204 dispara publicación de HEAD completo | Un comando genera manifiesto v2; guard valida base real, alcance completo, CI exacta y rollback. JSON v1 no se activa ni sobrescribe en esta auditoría. |
| v1.3-pos-web-deploy.yml | Ejecutable | Exige rama/HEAD actual, dry-run, hash y health; antes no verificaba scope/CI completa | Conservar controles; sumar guard y artifact de estado Cloudflare anterior. |
| CANON Critical / E2E / OpenCode CI | Ejecutable | Paths y E2E solo PR impedían demostrar CI sobre target integrado | Agregar push CANON de las tres suites; filtros de PR conservados. Costo: CI completa en cada merge para release verificable. |
| tests/final-repository-boundaries, security-secret-separation | Ejecutable | Escaneo secretos, límites y SHA pinning; fixture antigua ya corregida en #1048 | Conservados sin exclusiones nuevas. |
| POS/js/work-host.js | Flag real | featureEnabled=false y solo ?work=1 en CANON base; por eso WORK no es Inicio | #1047 propone default hosted y ?work=0; añade correcciones sesión/historial/voz. No publicado sin verificación requerida. |
| POS/js/config/pos-permissions.js FEATURE_LOCKS | Flags reales compartidos | Ausente=true, módulos incompletos o no liberados quedan bloqueados; proximamente.js consulta misma tabla | Conservar; no desbloquear funciones indiscriminadamente. WORK tiene flag propio revisado aparte. |
| Browser CANON | Sesión real | Redirige a launcher: Este navegador todavía no está activado | Autenticación/datos reales no verificados. No crear ni copiar credenciales desde el chat. |
| E2E local | Limitación entorno | http-server no arranca: uv_interface_addresses, Node 24.22.1; intento servidor Python no disponible al runner | No atribuir a bug de aplicación ni informar E2E PASS. Usar CI Node22 y conservar bloqueo de validación real. |

## Inventario estático completo de workflows

| Workflow | Eventos declarados / restricciones relevantes |
|---|---|
| `.github/workflows/canon-critical-ci.yml` | pull_request, push |
| `.github/workflows/canon-migration-0023.yml` | push |
| `.github/workflows/canon-migration-0024.yml` | push |
| `.github/workflows/canon-migration-0025.yml` | push |
| `.github/workflows/canon-migration-0026.yml` | push |
| `.github/workflows/canon-migration-0027.yml` | push |
| `.github/workflows/canon-migration-0028.yml` | push |
| `.github/workflows/canon-migration-0030.yml` | push |
| `.github/workflows/canon-migration-0031.yml` | push |
| `.github/workflows/canon-migration-0032.yml` | push |
| `.github/workflows/canon-migration-0033.yml` | push |
| `.github/workflows/canon-migrations-0021-0022.yml` | push |
| `.github/workflows/canon-whatsapp-receipts-activation.yml` | push |
| `.github/workflows/e2e-smoke-ci.yml` | push, pull_request; condiciones: ${{ !cancelled() }} |
| `.github/workflows/opencode-config-ci.yml` | pull_request, push |
| `.github/workflows/owner-backup-recovery-drill.yml` | workflow_dispatch; condiciones: ${{ always() && env.DRILL_DB_ID != '' }} |
| `.github/workflows/production-release.yml` | push |
| `.github/workflows/staging-deploy.yml` | push; condiciones: ${{ always() && env.STAGING_SMOKE_SESSION_ID != '' && env.STAGING_D1_DATABASE_ID != '' }} |
| `.github/workflows/v1.3-canon-red-diagnostic.yml` | push |
| `.github/workflows/v1.3-first-live-sale.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-live-migration-0018.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-owner-validation-readonly.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-pos-web-deploy.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-prod-browser-cors-hotfix.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-prod-cutover.yml` | push, workflow_dispatch; condiciones: ${{ always() && env.REHEARSAL_DB_ID != '' }} |
| `.github/workflows/v1.3-prod-debt-reconcile-apply.yml` | push; condiciones: ${{ env.HAS_DEBT_RECONCILIATION == '0' }} |
| `.github/workflows/v1.3-prod-preflight.yml` | push, workflow_dispatch |
| `.github/workflows/v1.3-turso-prod-cutover.yml` | push; condiciones: ${{ failure() && env.TURSO_CUTOVER_DEPLOYED == '1' }} |
| `.github/workflows/v1.3-turso-prod-debt-reconcile.yml` | push |
| `.github/workflows/v1.3-turso-prod-worker-hotfix.yml` | push; condiciones: ${{ failure() && env.HOTFIX_DEPLOY_ATTEMPTED == '1' }}; ${{ success() }} |
| `.github/workflows/visual-regression.yml` | pull_request, workflow_dispatch; condiciones: always() |

## Flags de funciones (conservados)

| Función | Bloqueada |
|---|---|
| venta-exitosa-comprobante | true |
| credito-cuotas | true |
| reparto-abono-multiples-deudas | true |
| lotes-multiples-fefo | true |
| stock-negativo-configurable | false |
| app-pedidos-marca-propia | true |
| cambiar-clave-usuarios | true |
| conversion-masiva-documentos | true |
| vendedor-en-venta | true |
| comentarios-venta | true |
| despacho-productos | true |
| cliente-historial-compras | false |
| vendedor-por-cliente | true |
| consulta-dni-ruc | true |
| edicion-masiva-productos | false |
| marcas-productos | true |
| subcategorias-atributos | true |
| produccion-recetas | true |
| registro-sanitario | true |
| numero-serie-producto | true |
| tipos-movimiento-inventario | true |
| conciliacion-bancaria | true |
| historial-exportaciones | true |
| catalogo-reportes | true |
| importar-proveedores | true |
| periodo-contable-percepcion | true |
| desbloquear-usuario | true |
| detraccion-retencion | true |
| historial-precios-producto | false |
| canales-venta | true |
| estado-recepcion-compras | true |
| adjuntos-proveedor | true |
| dashboard-compras | true |
| recargo-servicio | true |
| producto-activo-venta | true |
| precio-min-max | true |
| cajas-multiples | true |
| reporte-productos-vencer | false |
| cierre-remoto-cajas | true |
| dashboard-tesoreria | true |
| producto-servicio | true |
| catalogo-desde-pos | true |
| clonar-venta | true |
| nota-credito-parcial-compras | true |
| clientes-filtro-deuda | false |
| clientes-deudores-caja | false |
| clientes-dias-credito | true |
| nota-credito-devolucion-parcial | true |
| ordenes-compra | true |
| sesion-unica-usuario | true |
| firma-digital | true |
| cierres-sucursal-moneda | true |
| impresion-directa-xprinter | true |
| clientes-direcciones-multiples | true |
| clientes-descuento | true |
| clientes-frecuencia | false |
| listas-precios-asignacion-masiva | true |
| historial-compras-producto | false |
| inventario-padre-hijo | true |
| inventario-ubicacion-responsables | true |
| creditos-vencimiento | false |
| gastos | false |
| reportes | false |
| cotizaciones | true |
| cuentas-pagar | true |
| compartir-pdf-whatsapp | true |
| filtro-fechas-export | false |
| pedidos-pos | true |
| pedido-a-boleta | true |
| venta-por-presentacion | true |
| app-android-nativa | true |
| valorizacion-inventario | false |
| reporte-arqueo | false |
| reporte-medio-pago | true |
| cpe-sin-internet | true |
| venta-granel | true |
| gaveta-dinero | true |
| tipos-gasto | true |
| gasto-con-foto | true |
| gasto-a-cuenta | true |
| comprobante-por-correo | true |
| reporte-ventas-stock | false |
| app-almaceneros | true |
| equipos-pos | true |
| asistente-virtual | true |
| tipo-cierre | true |
| shopify-woocommerce | true |
| bandeja-multicanal | true |
| plan-distribuidor | true |
| clientes-puntos | true |
| conteo-fisico | true |
| sucursales | true |
| recetas-psicotropicos | true |
| sunat-comprobantes | true |
| etiquetas-precios | false |
| productos-sin-movimiento | false |
| sugerencia-compra | false |
| ajustes-inventario | false |
| permisos-por-empleado | false |
| promociones-combos | true |
| delivery | true |
| catalogo-en-linea | true |
| recordatorios-recompra | true |
| kardex | false |
| metas-comisiones | true |
| notificaciones-dueno | true |
| offline-mejorado | true |
| venta-voz | true |
| cobro-qr-yape-plin | true |
| cierre-billetes | true |
| asistencia-empleados | true |
| turnos-personal | true |
| proveedores | true |
| sustitutos-genericos | true |
| interacciones-medicamentos | true |
| historial-clinico | true |
| encuestas | true |
| apartados | true |
| tarjetas-regalo | true |
| auditoria-cambios | true |
| panel-tv-pedidos | true |
| multi-moneda | true |
| balanza | true |
| ventas-espera | true |
| guias-remision | true |
| sunat-resumen-anulaciones | true |
| clientes-documentos-listas | true |
| importar-clientes | true |
| precio-por-margen | false |
| edicion-masiva-precios | false |
| transferencias-almacenes | true |
| transferencias-cajas | true |
| bancos-depositos | true |
| punto-equilibrio | true |
| tarjeta-recargo | true |
| serie-por-cajero | true |
| atajos-teclado | true |
| servicios-recargas | true |
| reporte-igv | true |
| rotacion-abc | false |
| calendario-gastos | true |
| multi-ruc | true |

## Evidencia de revisión independiente

Agente `/root/review_release`, separado del implementador, revisó el diff y ejecutó pruebas sin modificar archivos. Encontró: base no contrastada con producción; CI ausente en merge SHA; fetch shallow; identificación CI solo por nombre; evidencia de revisión como cadena. Resueltos mediante lectura de build-info real, push CI CANON, fetch completo, path/event de workflow y recibo versionado con SHA y control de cambios posteriores.

WORK: revisión independiente de host/bridge y 5 VM iniciales. Halló falta de history en API y micrófono sin cleanup al salir. Nuevas regresiones RED→GREEN corrigen ambos. No equivale a sesión real validada.

Verificación local final: política/release 56 pruebas (incluye integración CLI con Git temporal); WORK/permisos 46 pruebas. Node local v24.22.1, CI configurada Node22. Diff y sintaxis verificados. Los resultados CI finales y merges se registran en el PR, no se dan por hechos aquí.

No se modificaron secretos, datos remotos, backend, migraciones, outbox ni triggers históricos; no se inició cutover. No se ejecutó despliegue en esta fase.
