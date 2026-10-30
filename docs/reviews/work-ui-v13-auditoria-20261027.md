# Auditoría inicial WORK V1.3: sustitución visual sin duplicar el POS

Fecha: 2026-10-27 (America/Lima). **Solo documentación; no despliegue, merge ni cambios comerciales.**

## Identidad verificable

- Repositorio: `quijanopomae-crypto/nuevo-amanecer-pos`.
- Rama CANON de desarrollo: `feature/v1.3-mobile-cloud`.
- HEAD leído al iniciar: `50840635b6f89d1d63b8bd4934e8a5382a64a1d4`.
- Rama de auditoría: `feature/work-ui-v13-integracion-20261027`, creada a partir de ese HEAD.
- Referencia visual del usuario: `Nuevo_Amanecer_WORK_Vista_Previa.html`; Git blob SHA-1 calculado localmente: `70551e217a6da35d99dd85adec7494627e450f10` (298710 bytes).
- CANON web: `https://nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev/`. Consulta pública a `/health`: HTTP 200, `ok=true`, `environment=production`, `d1=ok`. El `/app/sw.js` servido declara `CACHE_NAME` con `15e5dcd4229b51e27ffb7b0b4e3269f8e9b3719c`. Es un **marcador de la versión del shell**, no una prueba de funcionamiento de la sesión autenticada.
- `/app/work/index.html` responde HTTP 200 y mantiene el diseño, pero accediendo directamente expone el modo demostración; la integración real depende de abrirlo desde el POS autenticado como iframe.
- El HEAD de código y el identificador servido por CANON no coinciden. No asumir que `50840635` ni los PR abiertos están publicados.

## Reglas y arquitectura consultadas

Se leyeron `AGENTS.md`, `AGENTS_Nuevo_Amanecer.md`, `REPO_MAP.yaml` y `docs/DEVELOPMENT_RISK_POLICY.md`. La instrucción específica del propietario en esta misión prevalece: **NO merge ni publicación sin «Aprobado al canon»**. No tocar BD, Worker, ventas, pagos, créditos, inventario, permisos ni outbox por el rediseño.

- `POS/index.html`: shell real, módulos comerciales y `#pageMenu` heredado.
- `POS/js/work-host.js`: instancia `iframe` de WORK, mantiene la autoridad del POS y entrega métricas, actividad y consultas del motor existente.
- `POS/work/index.html`: versión del diseño WORK con una etiqueta y lógica de demostración para su apertura directa.
- `POS/work/work-canon-bridge.js`: intercepta eventos de la maqueta al abrirse en iframe *same-origin*, sustituye respuestas simuladas y métricas de ejemplo por datos del host, pinta tarjetas tipadas y hace `postMessage` con origen validado.
- `POS/js/modules/asistente/asistente-ui.js` y motor `NA_ASISTENTE`: reutilizados; el host llama al endpoint autenticado `/auth/assistant/chat` mediante `NA_ROLES.api`. La confirmación usa la puerta del asistente original.
- Las cifras se leen del DOM canónico de `#pageMenu .quick-stats` y la actividad de `#naMobileActivityList` **solo para rol dueño autorizado**; de otro modo se muestran guiones. La integridad y cobertura de todos los indicadores requiere E2E autenticado.

## Matriz pantalla/comportamiento

| Superficie del HTML | Estado observado en código | Decisión para integración | Comprobación exigida |
| --- | --- | --- | --- |
| Hero, esfera Aurora y paleta | Maqueta y `POS/work/index.html` tienen estructura visual WORK | Conservar la versión existente y corregir solo diferencias medibles respecto al adjunto | Capturas comparables 320/360/390/430/768/1024/1366/1920 |
| Inicio único | `work-host.js` abre iframe, pero el HEAD conserva `?work=0` para el Inicio antiguo | Reutilizar PR #1079; no crear un segundo Inicio/host | Inicio antiguo no visible; ventas, caja y menú disponibles |
| Menú lateral | `work-canon-bridge.js` mapea nueve entradas a `goPage` protegido | Conservar rutas, permisos y DOM operativo | Acceso permitido y denegado en cada ruta |
| Ventas/caja/créditos/stock | Host lee KPI desde `#pageMenu` según permisos; el bridge borra los valores demo | Mantener origen canónico sin inventar importes | Comparación con datos sintéticos controlados y sesión real autorizada |
| Actividad reciente | Host usa `#naMobileActivityList`; bridge elimina filas ficticias | Conservar la consulta y tratamiento de ausencia de datos | No exponer operaciones de ejemplo o de otro rol |
| Chat WORK | Bridge reenvía texto al host; host reutiliza `NA_ASISTENTE` y `/auth/assistant/chat` | Conservar un solo controlador y puerta de confirmación | Mensajes, historial, errores, propuestas y una confirmación idempotente |
| Tarjetas/tablas | Bridge crea DOM con `textContent`, tablas navegables y botones de confirmación | Conservar y reforzar pruebas de regresión | Autorización en servidor, token no expuesto al iframe, filas recortadas identificadas |
| Flash/Pro/Ultra | Selector mostrado; bridge advierte que **no selecciona modelo del servidor** | Marcar como selección solo visual; no prometer routing real | No anunciar un modelo no conectado |
| Adjuntos/imagen | Adjuntos son vista previa local; bridge impide enviarlos al backend | Mantener aviso real; multimodal fuera del alcance | Adjuntos no se presentan como procesados; sin efectos silenciosos |
| Voz | SpeechRecognition del navegador y SpeechSynthesis por turnos; no Live real | Conservar fallback por turnos y estado no disponible | Micrófono/permisos, salida, dictado y teclado Android |
| Responsividad | `visualViewport`, safe areas y `prefers-reduced-motion` en la referencia | Preservar; revisar implementación en dispositivos | Sin solapes, tecla atrás, scroll, composición y movimiento reducido |

## PR que compiten

- [#1079](https://github.com/quijanopomae-crypto/nuevo-amanecer-pos/pull/1079), `fix/work-primary-ui-no-legacy-home-20261026`, HEAD `fa9b00083723a1422ba84342593ab9450c39ebc6`. Draft, abierto, mergeable según consulta. Cambia `POS/index.html`, `POS/js/work-host.js`, `POS/work/work-canon-bridge.js` y tests. **Candidato a reutilizar**: una vez se revise contra HEAD y CI, no reimplementar lo mismo.
- [#1052](https://github.com/quijanopomae-crypto/nuevo-amanecer-pos/pull/1052), `fix/work-only-home-20261025`, HEAD `0f8b93d5c88bde2ec00b73d8e677258dc3b4c45f`. Abierto, no mergeable; objetivo duplicado sobre base antigua. No integrar ambos.
- Comparación `50840635...fa9b0008`: ramas divergentes, PR #1079 adelantado siete commits y atrasado uno respecto al HEAD consultado.

## Estado verificado de PR #1079

- Commit `fa9b0008`: CANON Critical CI **success**; Visual Regression **success**; E2E Smoke CI **failure** (GitHub Actions run `40422143936`).
- E2E: 973 passed, 1 failed, 8 flaky. Caso final fallido: `tests/e2e/compras-factura-duplicada.spec.ts:76`, empleado; el test esperaba una referencia documental en el aviso y recibió una validación previa de línea/lote. **No está demostrado** si lo causa el rediseño, el fixture o una regresión existente. No rebajar el test ni declarar CI verde.
- Sin prueba de integración end-to-end de CANON autenticado para este PR.

## Inspección del HTML aportado (local, sin conectarlo a producción)

11/11 verificaciones estructurales locales PASS: cabecera/hero, cuatro KPI, menú, chat/compositor, voz/subtítulos, dictado/adjuntos, etiquetas Flash/Pro/Ultra, reduced motion, viewport Android, ausencia de cliente `fetch` propio y etiqueta de demostración. **Son verificaciones estructurales del adjunto, no CI del repositorio ni pruebas de integración.**

## Trabajo siguiente (PR separados y revisables)

1. Primero diagnosticar la prueba E2E fallida de #1079 y determinar si falla también en base. Actualizar/reconciliar ese PR con el HEAD actual, ejecutar CI del nuevo commit y validar screenshots; no duplicar su modificación.
2. Comparar visualmente `POS/work/index.html` integrado con el HTML adjunto, por pantalla y breakpoint. Preservar el puente, animaciones, CSS de voz y teclado; aplicar únicamente diferencias verificadas en PR de interfaz.
3. Probar navegación y KPIs con origen CANON, roles dueño/empleado y estados offline; no tocar backend en una misión visual.
4. Probar chat, tarjetas, voz por turnos, errores de red, recarga, sesión y operaciones en curso; incluir evidencia real del SHA exacto.
5. Mantener #1052 sin integrar mientras se decide su cierre por duplicación. Preparar plan de rollback y verificación de producción antes de solicitar «Aprobado al canon».

## Límites y decisión

**AUDITORÍA DOCUMENTAL: COMPLETADA en la superficie inspeccionada. IMPLEMENTACIÓN VISUAL: PARCIALMENTE PRESENTE EN CANON; PR #1079 PENDIENTE. CIERRE COMPLETO: BLOQUEADO POR E2E / PR ABIERTO / PRUEBA AUTENTICADA.**

Esta rama no modifica ningún módulo ejecutable ni recursos de producción. No abrir release ni intentar forzar green. Solo avanzar a merge/deploy cuando el propietario escriba exactamente «Aprobado al canon» y se cumplan las verificaciones necesarias.
