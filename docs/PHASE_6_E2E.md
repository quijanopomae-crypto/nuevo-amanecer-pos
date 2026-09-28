# Fase 6 — Suite E2E de humo para POS (Playwright)

**Estado:** propuesta durable inicial. Autorizada explícitamente por el propietario.
**Rama:** `hardening/phase-6-e2e-playwright`.
**Fuente de verdad relacionada:** `docs/V1.3_STATUS.md`, `AGENTS.md`, `REPO_MAP.yaml`.

## Objetivo

Agregar una suite de pruebas end-to-end (E2E) de humo que valide, en un navegador real headless, que la aplicacion CANON `POS/index.html` carga y que los flujos de navegacion basicos entre modulos funcionan. Esta suite es infraestructura de prueba; **no** modifica el producto CANON ni el runtime.

## No-objetivos

- No modifica ningun archivo bajo `POS/**` (producto CANON).
- No modifica `laboratorio/**` ni `tools/**`.
- No toca infraestructura de despliegue, D1, R2 ni Cloudflare.
- No ejecuta ventas reales ni toca autoridad canonica.
- No sustituye la suite critica de regresion CANON existente.

## Alcance de archivos autorizado

Solo se permite crear/modificar:

- `package.json` (nuevo; solo devDependencies de test y scripts)
- `package-lock.json` (generado)
- `playwright.config.ts` (nuevo)
- `tests/e2e/**` (nuevo)
- `.github/workflows/e2e-smoke-ci.yml` (nuevo)
- `.gitignore` (agregar `node_modules/`, `test-results/`, `playwright-report/`)
- `docs/PHASE_6_E2E.md` (este documento)
- `laboratorio/pos-lab/preflight/PHASE_6_E2E.json` (Task Contract + recibo)

Cualquier escritura fuera de esta lista convierte el resultado en FAIL.

## Estrategia de prueba

Las pruebas sirven `POS/` como sitio estatico local (servidor estatico efimero) y usan selectores reales verificados contra `POS/index.html`:

- Carga inicial: `#pageMenu` visible, titulo correcto.
- Navegacion a POS: click en `.module-card` -> `goPage('pagePOS')` -> `#pagePOS` activo, `#posSearch` presente.
- Navegacion a Inventario/Clientes/Caja/Ventas/Gastos/Config via `.module-card`.
- Boton `#backBtn` retorna a `#pageMenu`.
- Estado inicial del carrito: `#cartBadge` = 0, `#btnPagar` deshabilitado.

Datos: exclusivamente sinteticos generados en el test; ninguna credencial ni dato comercial real.

## CI

Workflow nuevo `e2e-smoke-ci.yml`:
- se dispara en pull_request que toque `tests/e2e/**`, `POS/**` o el propio workflow;
- instala Node LTS, `npm ci`, `npx playwright install --with-deps chromium`;
- corre `npm run test:e2e` headless;
- publica el reporte como artifact.

Es un check adicional; no reemplaza `canon-critical-ci` ni `lab-cloud-ci`.

## Rollback

Revertir el merge de esta rama elimina toda la suite sin efecto sobre CANON, ya que ningun archivo de producto depende de estos artefactos en runtime.
