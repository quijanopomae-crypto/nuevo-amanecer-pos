# AGENTS.md — Cómo trabajar en Nuevo Amanecer (guía corta)

CANON_DEFAULT = true · POS_LAB_RETIRED = true · rama activa: `feature/v1.3-mobile-cloud`

Objetivo: que un cambio pequeño (CSS, texto, color, espaciado) sea fácil de hacer y de publicar, también desde el móvil. Guía paso a paso: `docs/GUIA_CAMBIO_RAPIDO.md`. Política de riesgo y publicación: `docs/DEVELOPMENT_RISK_POLICY.md`.

## Regla principal

El objetivo o pedido del dueño es la autorización de todo ese alcance, incluida la publicación al terminar (el dueño, en la sala, 25/10/2026: «mi pedido es la autorización, publiquen con respaldo sin preguntarme»); no pidas OK de nuevo por paso. «Cambia X», «aplícalo», «corrígelo», «continúa» cubren cambio, pruebas, PR, integración y publicación. Haz solos respaldo, pruebas y rollback; no exijas validación visual previa. Pregunta solo si sales del alcance pedido, si algo es irreversible fuera de lo pedido, o si falta un secreto o dato que solo él tiene (que lo pegue en su propio chat). Si no puedes probar algo, dilo y sigue.

## Flujo (5 pasos)

1. Parte del HEAD de `feature/v1.3-mobile-cloud` y crea una rama `feature/*`, `fix/*` o `perf/*`.
2. Haz el cambio mínimo, solo del alcance pedido.
3. Corre las pruebas del archivo tocado (Node 22: `node --test tests/<carpeta>/<archivo>.test.mjs`); compara con la base: cero fallos nuevos.
4. Abre PR; que pase CANON Critical CI y E2E Smoke CI. Un fallo se clasifica como regresión real o prueba obsoleta; nunca se tapa ni se debilita una prueba para dar verde.
5. Integra y, si el dueño lo pidió, publica (ver guía). Borra la rama.

## Riesgo, en una línea

BAJO = solo CSS/texto/iconos sin datos: autorrevisión del diff + pruebas + CI, sin revisor externo. MEDIO = pantallas que usan una API existente: revisión técnica documentada. ALTO = ventas, pagos, crédito, caja, inventario, clientes, permisos, sincronización, migraciones, Worker: revisión independiente (puede ser automatizada) y respaldo. Se usa el riesgo mayor del cambio real.

## Protecciones que se mantienen (las ejecutas tú, sin pedir OK si el pedido las cubre)

- Layouts de Venta (`#pagePOS`) e Inicio (`#pageMenu`): se cambian cuando el pedido nombra esa pantalla; ese pedido basta.
- Permisos y candados: `POS/js/config/pos-permissions.js` (tabla única, denegación por defecto, `FEATURE_LOCKS`). Costos, totales y proveedores son solo del dueño. Todo cambio de permiso lleva prueba de cliente y de servidor. No abrir candados en bloque.
- Datos de producción: migraciones solo aditivas, con respaldo previo de la BD obligatorio (lo haces tú, sin pedir OK); nunca borrar datos de producción (solo lo que el dueño pida borrar expresamente, y con respaldo previo); nunca alterar ventas ni abonos pendientes (outbox).
- Secretos: nunca escribir tokens, claves ni datos de clientes en código, docs, logs o prompts. Cambiar secrets solo si el pedido lo incluye; si falta el valor, lo pone el dueño en su chat.
- Worker de producción y backend: `tools/cloudflare-lab/**` (nombre histórico, es producción), `tools/cloudflare-prod/**`, `tools/cloudflare-backup/**`. No se borra ni se renombra por nombre.
- Publicación: la web se publica con el manifiesto de `tools/release/web-release.mjs` (rollback, SHA de producción y CI exacta). Obligatorio siempre, sin pedir OK: respaldo previo de la BD antes de migraciones o Worker, el Worker se publica primero y luego la web, `rollback_ref` y SHA de producción igual a la base, los 3 CI exactos y revisión independiente en riesgo ALTO. Force-push: siempre prohibido. Workflows de cutover/migración: solo si el pedido los nombra.
- POS-LAB está retirado: no crear ramas `lab/*` ni escribir en `laboratorio/**`. El modo SHADOW legacy sigue con `PRODUCT_WRITE = DENIED`.
- No editar `POS/css/experience-v2/pages/*.css`. No commitear `POS/index.html`, `POS/css/base.css`, `POS/css/components.css`, `POS/css/layout.css` ni `evidence/**` si los sobrescribió la suite (restaurar con `git checkout`).

## Diseño

Siempre: hora de Lima (`America/Lima`), sin `innerHTML` (usa `textContent` o `createElement`), no uses el puerto 4173 (E2E en otro puerto libre) y dinero, costos y TOTAL son solo del dueño: no cambian sin él.

Teléfono primero (390 px). Revisa como mínimo 390, 768 y 1366 px cuando el cambio es visual. Los 8 anchos de `AGENTS_Nuevo_Amanecer.md` son referencia para trabajo grande, no requisito de un cambio de 1 línea.

## Contexto adicional (leer solo si hace falta)

`docs/codex/BUSINESS_CONTEXT.md`, `docs/codex/ARCHITECTURE.md`, `docs/codex/TESTING.md`, `AGENTS_Nuevo_Amanecer.md` (reglas funcionales), `.opencode/ROLE_MAP.md` (roles), skills en `.agents/skills/`. Ningún agente nominal ni revisor humano externo es obligatorio.
