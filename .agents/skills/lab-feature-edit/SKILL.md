---
name: lab-feature-edit
description: "Implementa funciones nuevas exclusivamente en LAB con alcance explícito; fixtures sintéticos por defecto y copia real solo dentro de D1 LAB autorizado."
---

# LAB Feature Edit

Antes de programar:
- Lee `AGENTS.md`, `lab-scope-guard`, `UI_MAP.yaml` y el contrato.
- Identifica sección, DOM, JS, storage e invariantes afectados.
- Si cruza caja/inventario/créditos aplica también las skills de integridad existentes.

Reglas:
- Prototipo primero en `laboratorio/pos-lab/` o `laboratorio/experimentos/`.
- No modificar CANON mientras el estado sea DRAFT/ITERAR.
- No usar credenciales de producción en cliente/repositorio ni escrituras de producción.
- Fixtures y unit tests: datos sintéticos por defecto.
- Integración funcional puede usar la copia real aislada de D1 LAB solo mediante el flujo autorizado CANON -> R2 -> D1 LAB; nunca versionar esos datos ni tratarlos como CANON.
- No inventar dependencias cruzadas.
- Mantener cambios mínimos y reversibles.
- Si hace falta tocar un archivo no permitido, detenerse antes de tocarlo.

Salida: DESCARTAR, ITERAR o CANDIDATO_A_CANON.
