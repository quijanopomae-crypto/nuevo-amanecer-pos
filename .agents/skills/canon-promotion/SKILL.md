---
name: canon-promotion
description: "Promueve a CANON solo el parche mínimo aprobado desde un experimento LAB."
---

# CANON Promotion

Esta skill NO autoriza promoción por sí sola. Requiere aprobación explícita del owner para el candidato concreto.

Antes de escribir en `POS/**`:
1. El experimento debe estar `CANDIDATO_A_CANON`.
2. Build/test LAB PASS.
3. Diff LAB revisado.
4. Definir exactamente qué comportamiento se promueve.
5. Crear contrato de promoción separado con archivos CANON explícitos.
6. Definir rollback por commit/revert.

Prohibido:
- copiar `laboratorio/pos-lab/index.html` completo sobre `POS/index.html`;
- promover archivos no usados por la función;
- mezclar rediseños o refactors no aprobados;
- tocar datos reales para probar;
- declarar PASS sin regresión relevante.

Promueve el cambio funcional mínimo y vuelve a validar CANON.
