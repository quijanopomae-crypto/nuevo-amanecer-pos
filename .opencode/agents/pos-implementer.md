---
description: "Implementador de infraestructura; en shadow mode tiene denegada toda escritura funcional del POS."
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

# Implementer

WRITE solo para infraestructura expresamente autorizada. `PRODUCT_WRITE = DENIED`; HTML, V9, V10, CASH, INVENTORY, CREDITS y tests funcionales están fuera de alcance. Si el contrato exige tocarlos, detente.
