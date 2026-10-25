# Guía de cambio rápido (CSS / texto / color)

Para el dueño o cualquier agente (ChatGPT, Codex, OpenCode), también desde el móvil. Un cambio pequeño no necesita más que esto.

## 1. Hacer el cambio

1. Rama nueva desde `feature/v1.3-mobile-cloud`: `fix/<tema>` o `feature/<tema>`.
2. Edita solo el archivo que corresponde (CSS en `POS/css/`, textos en `POS/js/` o `POS/index.html`). Una línea basta si eso es lo pedido.
3. Mira el diff completo antes de guardar.

## 2. Probar rápido (Node 22)

```sh
node --test tests/product-fixes/canonical-ui-contract.test.mjs   # contrato de UI
node --test tests/<carpeta>/<prueba-del-archivo>.test.mjs        # la prueba del módulo tocado
```

No hay más pasos locales. El resto lo hace CI en el PR: CANON Critical CI y E2E Smoke CI. Si una prueba ya fallaba en la base, no cuenta como fallo tuyo (compara con la base).

## 3. Revisión según riesgo

- BAJO (solo CSS/texto/iconos, sin datos): revisa tu propio diff y anótalo en el PR en una línea. No hace falta revisor externo.
- MEDIO / ALTO (ventas, pagos, crédito, caja, inventario, clientes, permisos, sincronización, migraciones, Worker): sigue `docs/DEVELOPMENT_RISK_POLICY.md`.

## 4. Capturas (solo cuando cambias Inicio o Venta)

La prueba `Visual Regression` compara 32 capturas de Inicio y Venta con un margen de 0,1 %. Si cambiaste a propósito esas pantallas, la prueba fallará hasta renovar las capturas:

1. Abre el PR → pestaña Checks → `Visual Regression` → descarga el artefacto `visual-results`.
2. Revisa las imágenes `actual` (nunca uses una `diff`) y cópialas sobre `tests/visual/__screenshots__/visual.spec.ts/` con el mismo nombre. Commit en el mismo PR.

Un cambio que no toca Inicio ni Venta no necesita capturas.

## 5. Integrar y publicar

- Integrar: merge del PR cuando CI esté verde. Borra la rama.
- Publicar la web solo si el dueño lo pidió: `docs/DEVELOPMENT_RISK_POLICY.md` (manifiesto con SHA de producción, rollback y alcance). La lista de alcance incluye solo lo que se publica o define el gate: `POS/**`, `tools/cloudflare-pos-web/**`, `tools/release/**`, el workflow de deploy, el `package.json`/lock de `tools/cloudflare-lab` y los 3 workflows de CI exigidos.

## Lo que no se toca (sigue protegido)

Permisos y candados (`POS/js/config/pos-permissions.js`), costos/totales/proveedores solo del dueño, migraciones (con respaldo y OK del dueño), ventas/abonos pendientes, secretos, `tools/cloudflare-lab/**` (Worker de producción), `POS/css/experience-v2/pages/*.css`.
No commitees `POS/index.html`, `POS/css/base.css`, `POS/css/components.css`, `POS/css/layout.css` ni `evidence/**` si la suite de pruebas los sobrescribió (`git checkout -- <archivo>`).
