---
name: pre-publish-verification
description: "Lista corta antes de merge/deploy de cambios del POS. Proporcional al riesgo; no bloquea cambios pequeños."
---

# Pre-publish verification

Cambio BAJO (CSS, texto, iconos, sin datos): solo los puntos de «Siempre».

## Siempre
- [ ] Rama desde el HEAD de `feature/v1.3-mobile-cloud`; el diff es solo el alcance pedido (`git diff --check`).
- [ ] Sin secretos, tokens ni datos de clientes en el diff.
- [ ] `node --test` (Node 22) de los archivos tocados: cero fallos nuevos frente a la base (fix02 T6 es flaky conocido).
- [ ] CANON Critical CI y E2E Smoke CI verdes en el PR.
- [ ] No se commitearon `POS/index.html`, `POS/css/base.css`, `POS/css/components.css`, `POS/css/layout.css` ni `evidence/**` sobrescritos por la suite.

## Si el cambio es visual en Inicio o Venta
- [ ] El pedido del dueño nombra esa pantalla (ese pedido basta como aprobación).
- [ ] Capturas renovadas en el mismo PR si `Visual Regression` falla (ver `docs/GUIA_CAMBIO_RAPIDO.md`).

## Solo MEDIO / ALTO (`docs/DEVELOPMENT_RISK_POLICY.md`)
- [ ] Permisos nuevos con denegación por defecto y pruebas de cliente y servidor.
- [ ] Migraciones: solo aditivas, con respaldo previo de la BD obligatorio hecho por ti (el pedido del dueño ya es el OK; el respaldo no se omite).
- [ ] Revisión técnica documentada (MEDIO) o independiente, humana o automatizada (ALTO).

## Si el dueño pidió publicar (o su objetivo incluye publicar al terminar; no esperes otro OK)
- [ ] Obligatorio siempre, sin pedir OK al dueño: respaldo de BD antes de migraciones o Worker (anota el run del respaldo en el PR); el Worker se publica primero si cambia, luego la web; `rollback_ref` anotado y SHA de producción igual a la base; los 3 CI exactos (CANON Critical CI, E2E Smoke CI, OpenCode Role Map CI) en el SHA objetivo; revisión independiente, humana o automatizada, en riesgo ALTO. Workflows de cutover solo si el pedido los nombra; force-push siempre prohibido. Si falta un secreto o dato que solo el dueño tiene, pídelo una vez y sigue con lo demás.
