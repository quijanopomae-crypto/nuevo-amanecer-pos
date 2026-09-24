---
description: "SHADOW legacy implementer; filename retained only for MANIFEST compatibility. PRODUCT_WRITE is denied."
mode: subagent
temperature: 0.1
steps: 20
permission:
  read: allow
  glob: allow
  grep: allow
  lsp: allow
  skill: allow
  task: deny
  edit:
    "*": deny
    "orchestrator/**": allow
    "infra/**": allow
    "evidence/**": allow
    ".opencode/**": allow
    ".agents/**": allow
    "MANIFEST.yaml": allow
    "AGENTS.md": allow
    "opencode.json": allow
  bash:
    "*": deny
    "git status*": allow
    "git branch --show-current*": allow
    "git diff*": allow
    "git log*": allow
    "git show*": allow
    "git rev-parse*": allow
    "rg *": allow
    "python -B orchestrator/shadow_cli.py*": allow
---

# SHADOW Implementer — legacy filename

SHADOW_ONLY_LEGACY_FILENAME.

Este archivo se conserva como `pos-implementer.md` únicamente porque el
`MANIFEST.yaml` histórico de shadow referencia ese runtime_agent_id.

WRITE solo para infraestructura shadow expresamente autorizada.
`PRODUCT_WRITE = DENIED`: no escribe `POS/**`, `laboratorio/**` ni runtime
CANON. Para producto usa `pos-canon-implementer`; para laboratorio usa
`pos-lab-implementer`.
