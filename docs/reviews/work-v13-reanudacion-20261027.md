# WORK V1.3 — Reanudación de integración en HEAD vigente

Corte: 27/10/2026 (America/Lima). Rama de origen CANON: `feature/v1.3-mobile-cloud`; HEAD inicial comprobado: `639f5d15451c5ed5f57de37a74bb3ee2d40168da`. Trabajo aislado: `feature/work-ui-v13-integration-20261027-gpt6`.

## Referencia visual y comparación directa

Se comparó línea a línea el archivo aprobado `Nuevo_Amanecer_WORK_Vista_Previa.html` (Git blob `70551e217a6da35d99dd85adec7494627e450f10`, 1.755 líneas) con el archivo real `POS/work/index.html` de CANON (Git blob `7422334934d91cd210b0b0217658573a93bc0da2`, 1.751 líneas): **1.743 líneas iguales**, siete grupos de diferencias.

Diferencias deliberadas: CANON quita el rótulo flotante de "VISTA PREVIA"; sustituye las cuatro métricas ficticias por `— / Consultando CANON`; elimina cuatro movimientos de crédito ficticios; limita chat y voz a 1.500 caracteres (contrato del host); incorpora `work-canon-bridge.js`. No reemplazar estas decisiones por el HTML de demostración.

## Matriz de conservación / sustitución

| Superficie | Archivo actual | Decisión / integración |
|---|---|---|
| Identidad, hero, esfera Aurora, tarjetas, menú, chat y voz | `POS/work/index.html` | **Conservar** apariencia prácticamente idéntica al HTML aprobado; no crear un segundo archivo principal |
| Inicio hospedado antiguo y retorno `?work=0` | `POS/index.html`, `POS/js/work-host.js` | **Sustituir acceso visual heredado**; mantener `#pageMenu` oculto como DOM auxiliar para métricas y rutas |
| Botón «Volver al POS» del iframe | `POS/work/work-canon-bridge.js` | **Eliminar acceso redundante**; chat vuelve a WORK y menú abre módulos CANON |
| Ventas, inventario, clientes, caja, gastos, configuración | `POS/index.html` y módulos existentes | **Conservar íntegros**; navegar vía `goPage` respetando rol y sesión |
| Indicadores y movimientos | `work-host.js` → `work-canon-bridge.js` | **Reutilizar** lecturas `.quick-stats` y actividad real; solo propietario ve cifras sensibles; nunca usar importes demo |
| Chat, herramientas, propuestas y confirmaciones | `work-host.js` → motor `NA_ASISTENTE` → `/auth/assistant/chat` | **Conservar** backend, permisos, tokens de confirmación y tarjetas existentes; no duplicar el motor |
| Adjuntos y generación de imágenes | Bridge y HTML | **Mostrar límite real**; adjuntos en vista previa local, no enviar imágenes simuladas a WORK |
| Flash / Pro / Ultra | HTML y bridge | **Visual por ahora**; servidor decide modelo real, no afirmar enrutamiento no implementado |
| Voz | HTML y bridge | **Por turnos** usando APIs del navegador si disponibles; no afirmar Chat Live bidireccional |
| Teclado Android y animaciones | CSS/JS WORK existentes | Conservar `visualViewport`, áreas seguras y `prefers-reduced-motion`; prueba Android real pendiente |

## Reutilización del avance previo

Se adaptó el parche funcional del PR #1085 desde CANON actualizado, **sin introducir un Inicio alternativo** y sin copiar los valores ficticios del archivo adjunto. Los PR #1079, #1052, #1084 y #1085 se solapan con este trabajo: **fusionar como máximo una propuesta de Inicio único**, nunca sumarlas a ciegas. Se deja `tests/e2e/compras-factura-duplicada.spec.ts` sin copiar desde #1085 para preservar la corrección ya presente en CANON.

## Validaciones y límites

El PR desde esta rama debe ejecutar el AUTO-DEV CI **sobre su SHA final**. Se reutilizan pruebas de Inicio único, apertura del menú, host/bridge, antideflicker y capacidad de WORK. Aún se requieren capturas comparativas, navegador Android auténtico o su emulación, pruebas E2E, adjuntos, cancelaciones, orientación y errores de red; no se atribuye estado PASS a ninguna ejecución no observada.

### Seguridad y reversión

Solo `POS/index.html`, `POS/js/work-host.js`, `POS/work/work-canon-bridge.js` y pruebas; ningún cambio en BD, Turso/D1, Worker, outbox, precios, ventas, caja o permisos. Conservar CANON intacto hasta autorización explícita **«Aprobado al canon»**. Reversión mediante revert del commit de integración o rollback web a la versión previa comprobada, sin `force-push` ni borrado de datos.
