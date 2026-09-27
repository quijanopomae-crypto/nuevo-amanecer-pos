# CANON/LAB Promotion Infrastructure V1

## Objetivo

Convertir la promoción visual LAB → CANON en un proceso determinista, explícito y verificable sin cambiar el runtime comercial.

## Causa raíz

El repositorio ya mantiene una copia visual aprobada en LAB y otra en `POS/css/experience-v2/**`. En el estado inicial los 23 assets coinciden byte por byte, pero:

- la lista de archivos estaba duplicada dentro de un test;
- la promoción seguía dependiendo de copia manual;
- el test de paridad no formaba parte de CANON Critical CI;
- el deploy Hosted POS no rechazaba explícitamente drift visual antes de ensamblar.

## Diseño

`tools/pos-experience/visual-assets.mjs` es la allowlist única del paquete visual promovible.

`tools/pos-experience/promote-lab-visuals.mjs` tiene dos modos:

- `--check` (default): no escribe; verifica paridad, orden CSS y precache PWA.
- `--write --owner-approved`: copia únicamente los assets allowlisted LAB → CANON y vuelve a verificar.

El JavaScript Motion NO se copia byte por byte porque LAB y CANON usan lifecycle/namespace distintos. Su compatibilidad continúa protegida por los tests de bootstrap/lazy bridge.

## Gates

1. CANON Critical CI ejecuta la comprobación de paridad visual, la paridad integral de las 8 secciones DOM, el core compartido y los tests Motion/UI relacionados.
2. Hosted POS Deploy repite el mismo gate antes de ensamblar el sitio productivo.
3. Un drift visual hace fallar el pipeline antes del deploy.

## Límites

- No modifica `POS/**` en esta tarea.
- No modifica `laboratorio/**`.
- No toca datos, D1, R2, sesión, sync, outbox ni negocio.
- No despliega producción.
