# Fixture de caracterización

`CVV2.4_backup_antes_demo-1.baseline.html` es el **fixture autorizado** de la
caracterización estática del POS (FASE4-CHARACTERIZATION-BASELINE).

- **Generado automáticamente** desde el commit autorizado
  `b4003e2f0d84cdb832de9eff730f60dc946cbbbe` (base del baseline).
- **Blob del producto**: `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7`
  (verificado con `git rev-parse b4003e2f:CVV2.4_backup_antes_demo-1.html`).
- **NO editar a mano.** Si se corrompe o se borra, se regenera solo al ejecutar
  la suite con `ensureBaselineFixture()`, que re-extrae el blob con
  `git show` (buffer, sin redirección de shell) y re-verifica el SHA-1.

Este archivo es una copia exacta del estado autorizado de la línea base.
Actualización 2026-10-24: hoy `CVV2.4_backup_antes_demo-1.html` en la raíz tiene el
mismo blob (`2dec6363…`) y es byte a byte idéntico a este fixture (comprobado con
`cmp` y `git hash-object`); la nota anterior que lo daba por «otra versión»
(blob `505859a…`, HEAD `b7e2e83`) ya no es cierta. No se borra la copia de la raíz:
sigue protegida por `REPO_MAP.yaml` hasta que exista la prueba de la Fase 9.
