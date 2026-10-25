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
- [ ] Migraciones: solo aditivas, con respaldo previo.
- [ ] Revisión técnica documentada (MEDIO) o independiente, humana o automatizada (ALTO).

## Si el dueño pidió publicar
- [ ] Backend primero si cambia el Worker, luego la web; anota el rollback; nunca los workflows de cutover sin orden del dueño.
