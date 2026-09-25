---
description: "Preflight obligatorio y verificable antes de modificar POS-LAB."
---

No escribas código durante este preflight.

1. Lee `AGENTS.md`.
2. Lee `.agents/skills/impact-analysis/SKILL.md`.
3. Lee `.agents/skills/cross-module-impact/SKILL.md`.
4. Lee `.agents/skills/lab-scope-guard/SKILL.md`.
5. Lee la skill específica de la tarea: `lab-ui-edit`, `lab-animation-edit` o `lab-feature-edit`.
6. Lee `laboratorio/pos-lab/UI_MAP.yaml` cuando aplique.
7. Lee el Task Contract schema v3.

Declara antes de escribir:
`OBJECTIVE`, `ALLOWED_FILES`, `FORBIDDEN_FILES`, `READS`, `WRITES`, `DOM_AFFECTED`, `STATE_AFFECTED`, `STORAGE_AFFECTED`, `DOMAIN_INVARIANTS`, `CROSS_MODULE_IMPACT`, `RISKS`, `ROLLBACK` y `TESTS`.

Crea el recibo `laboratorio/pos-lab/preflight/<TASK_ID>.json` con los hashes Git blob de cada `SKILL.md` leído y ejecútalo con:

`node laboratorio/pos-lab/skill-preflight.mjs --task=<contrato> --receipt=<recibo>`

Solo `SKILL_PREFLIGHT_PASS` habilita escritura. El contrato y el recibo deben estar commiteados antes del primer cambio funcional.

Esta regla aplica a cualquier writer, incluido ChatGPT/conector GitHub, OpenCode, Claude, DeepSeek y Codex.
