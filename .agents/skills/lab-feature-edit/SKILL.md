---
name: lab-feature-edit
description: "Implementa funciones nuevas exclusivamente en LAB con alcance explícito y datos sintéticos."
---

# LAB Feature Edit

Antes de programar:
- Lee `AGENTS.md`, `lab-scope-guard`, `UI_MAP.yaml` y el contrato.
- Identifica sección, DOM, JS, storage e invariantes afectados.
- Si cruza caja/inventario/créditos aplica también las skills de integridad existentes.

Reglas:
- Prototipo primero en `laboratorio/pos-lab/` o `laboratorio/experimentos/`.
- No modificar CANON mientras el estado sea DRAFT/ITERAR.
- No usar credenciales, datos ni escrituras de producción.
- No inventar dependencias cruzadas.
- Mantener cambios mínimos y reversibles.
- Si hace falta tocar un archivo no permitido, detenerse antes de tocarlo.

Salida: DESCARTAR, ITERAR o CANDIDATO_A_CANON.
