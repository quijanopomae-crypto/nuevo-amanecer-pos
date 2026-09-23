---
name: lab-ui-edit
description: "Modifica interfaz del POS-LAB por sección/componente sin tocar lógica comercial ni CANON."
---

# LAB UI Edit

Lee primero `lab-scope-guard` y `UI_MAP.yaml`.

Para cambios puramente visuales:
- HTML: edita solo la sección concreta bajo `laboratorio/pos-lab/sections/`.
- CSS: edita `styles/pages/`, `styles/components/` o `styles/tokens.css` según el mapa.
- No edites `POS/**`.
- No cambies ventas, inventario, caja, créditos, persistencia, OUTBOX o sincronización.
- No edites `index.html` directamente: reconstruye con `build-lab.mjs`.
- Un cambio visual no autoriza JavaScript salvo que el contrato lo liste.

Validación mínima:
`node laboratorio/pos-lab/build-lab.mjs`
`node laboratorio/pos-lab/build-lab.mjs --check`
`node laboratorio/pos-lab/scope-guard.mjs --task=<contrato>`
