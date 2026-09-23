---
description: "Valida build, alcance y pruebas del POS-LAB antes de declarar PASS."
---

Ejecuta en este orden:
1. `node laboratorio/pos-lab/build-lab.mjs --check`
2. `node --test tests/laboratorio-*.test.mjs`
3. `node laboratorio/pos-lab/scope-guard.mjs --task=<contrato>`
4. `git diff --check`
5. `git diff`

Si cualquier paso falla, no declares PASS. Si aparece un archivo fuera del contrato, detente.
