# AGENTS.md — Cómo trabajar en Nuevo Amanecer (guía corta)

CANON_DEFAULT = true · POS_LAB_RETIRED = true · rama activa: `feature/v1.3-mobile-cloud`

Objetivo: que un cambio pequeño (CSS, texto, color, espaciado) sea fácil de hacer y de publicar, también desde el móvil. Guía paso a paso: `docs/GUIA_CAMBIO_RAPIDO.md`. Política de riesgo y publicación: `docs/DEVELOPMENT_RISK_POLICY.md`.

## Regla principal

El objetivo o pedido del dueño es la autorización de todo ese alcance, incluida la publicación al terminar (el dueño, en la sala, 25/10/2026: «mi pedido es la autorización, publiquen con respaldo sin preguntarme»); no pidas OK de nuevo por paso. «Cambia X», «aplícalo», «corrígelo», «continúa» cubren cambio, pruebas, PR, integración y publicación. Haz solos respaldo, pruebas y rollback; no exijas validación visual previa. Pregunta solo si sales del alcance pedido, si algo es irreversible fuera de lo pedido, o si falta un secreto o dato que solo él tiene (que lo pegue en su propio chat). Si no puedes probar algo, dilo y sigue.

## Flujo (5 pasos)

1. Trabaja desde el HEAD de `feature/v1.3-mobile-cloud`. Usa una rama/PR de integración solo cuando GitHub lo exija o si la misión modifica infraestructura crítica; nunca abras otro PR solo para publicar.
2. Haz el cambio mínimo, solo del alcance pedido.
3. Corre las pruebas del archivo tocado (Node 22: `node --test tests/<carpeta>/<archivo>.test.mjs`); compara con la base: cero fallos nuevos.
4. Haz una sola integración por misión y deja que AUTO-DEV CI ejecute contratos, permisos y pruebas de negocio según el riesgo, sin Playwright/E2E como requisito en ninguna publicación habitual. El nombre histórico `e2e-smoke` se conserva solo por compatibilidad con las reglas de GitHub: ejecuta pruebas rápidas de contratos y permisos. La suite E2E integral queda programada/manual e informativa, nunca bloquea cada cambio. Un fallo de integridad real sigue impidiendo publicar; no se tapan ni debilitan tests.
5. Tras integrar en CANON, AUTO-DEV publica CSS/recursos seguros y WORK UI aislada, si sus pruebas pasan. En WORK el agente añade por su cuenta al último commit `NA-Direct: true`, `NA-Mission: ...`, `NA-Paths: [...] ` (diff web completo) y `NA-Review-Kind: auto-ci`; el dueño no entrega recibos ni llena manifiestos. `POS/index.html` solo se autopublica con el blob de bootstrap WORK exacto del #1088. Negocio/Worker siguen protegidos.

## Riesgo, en una línea

BAJO = solo CSS/texto/iconos sin datos: autorrevisión del diff + pruebas + CI, sin revisor externo. MEDIO = pantallas que usan una API existente: revisión técnica documentada. ALTO = ventas, pagos, crédito, caja, inventario, clientes, permisos, sincronización, migraciones, Worker: revisión independiente (puede ser automatizada) y respaldo. Se usa el riesgo mayor del cambio real.

## Protecciones que se mantienen (las ejecutas tú, sin pedir OK si el pedido las cubre)

- Layouts de Venta (`#pagePOS`) e Inicio (`#pageMenu`): se cambian cuando el pedido nombra esa pantalla; ese pedido basta.
- Permisos y candados: `POS/js/config/pos-permissions.js` (tabla única, denegación por defecto, `FEATURE_LOCKS`). Costos, totales y proveedores son solo del dueño. Todo cambio de permiso lleva prueba de cliente y de servidor. No abrir candados en bloque.
- Datos de producción: migraciones solo aditivas, con respaldo previo de la BD obligatorio (lo haces tú, sin pedir OK); nunca borrar datos de producción (solo lo que el dueño pida borrar expresamente, y con respaldo previo); nunca alterar ventas ni abonos pendientes (outbox).
- Secretos: nunca escribir tokens, claves ni datos de clientes en código, docs, logs o prompts. Cambiar secrets solo si el pedido lo incluye; si falta el valor, lo pone el dueño en su chat.
- Worker de producción y backend: `tools/cloudflare-lab/**` (nombre histórico, es producción), `tools/cloudflare-prod/**`, `tools/cloudflare-backup/**`. No se borra ni se renombra por nombre.
- Publicación: el trabajo `publish-web` de AUTO-DEV CI usa `verify-direct` sin segundo PR/manifiesto para CSS, imágenes y WORK UI revisado; exige SHA real de producción, commit CANON vigente, las tres verificaciones internas exitosas, versión previa y reversión si falla la comprobación. Cambios funcionales de alto riesgo/infraestructura NO se autopublican sin revisión y respaldo reales: respaldo previo de la BD antes de migraciones o Worker, el Worker se publica primero y luego la web, `rollback_ref` y SHA de producción igual a la base, el AUTO-DEV CI exacto y revisión independiente en riesgo ALTO. Force-push: siempre prohibido. Workflows de cutover/migración: solo si el pedido los nombra.
- POS-LAB está retirado: no crear ramas `lab/*` ni escribir en `laboratorio/**`. El modo SHADOW legacy sigue con `PRODUCT_WRITE = DENIED`.
- No editar `POS/css/experience-v2/pages/*.css`. No commitear `POS/index.html`, `POS/css/base.css`, `POS/css/components.css`, `POS/css/layout.css` ni `evidence/**` si los sobrescribió la suite (restaurar con `git checkout`).

## Diseño

Siempre: hora de Lima (`America/Lima`), sin `innerHTML` (usa `textContent` o `createElement`), no uses el puerto 4173 (E2E en otro puerto libre) y dinero, costos y TOTAL son solo del dueño: no cambian sin él.

Teléfono primero (390 px). Revisa como mínimo 390, 768 y 1366 px cuando el cambio es visual. Los 8 anchos de `AGENTS_Nuevo_Amanecer.md` son referencia para trabajo grande, no requisito de un cambio de 1 línea.

La misión es única: no crear auditorías extensas, PR alternativos ni informes repetidos cuando el diff y el resultado de CI basten. Nunca saltarse verificaciones de integridad o permisos para acelerar.
Para cambios WORK de riesgo medio y aislados, el agente usa `NA-Direct: true`, `NA-Mission: descripción de la orden`, `NA-Paths: ["POS/work/index.html"]` (archivos web pendientes completos) y `NA-Review-Kind: auto-ci` en el commit final. Los checks de CANON son la revisión automática; no pedir recibos al propietario. Fuera de esa lista cerrada, mantener revisión técnica independiente cuando corresponda.

## Contexto adicional (leer solo si hace falta)

`docs/codex/BUSINESS_CONTEXT.md`, `docs/codex/ARCHITECTURE.md`, `docs/codex/TESTING.md`, `AGENTS_Nuevo_Amanecer.md` (reglas funcionales), `.opencode/ROLE_MAP.md` (roles), skills en `.agents/skills/`. Ningún agente nominal ni revisor humano externo es obligatorio.
