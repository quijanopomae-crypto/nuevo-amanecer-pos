---
name: lab-animation-edit
description: "Crea o modifica motion/animaciones LAB sin convertir animación en lógica de negocio."
---

# LAB Animation Edit

Lee `lab-scope-guard` y `UI_MAP.yaml`.

Archivos normales:
- `laboratorio/pos-lab/animations/**`
- `laboratorio/pos-lab/js/motion/**`
- CSS/HTML adicional solo si el contrato lo permite.

Invariantes:
- Animación = feedback visual, nunca fuente de verdad.
- Una venta, stock, caja, crédito o persistencia debe completar aunque motion falle.
- No esperes `animationend` para confirmar operaciones comerciales.
- Usa clases `lab-*` y respeta `prefers-reduced-motion`.
- No toques `POS/**`.

Después de editar ejecuta build, tests LAB y scope guard.
