# AGENTS.md — Shadow Mode de Orchestrator V1

## Autoridad y fallback

Este contrato project-local agrega Orchestrator V1 en **SHADOW MODE**. `AGENTS_Nuevo_Amanecer.md` continúa siendo la infraestructura V2 disponible como fallback y conserva las reglas funcionales históricas. Ante conflicto, la solicitud explícita del propietario y las prohibiciones de shadow mode tienen prioridad.

## Límite de shadow mode

- La infraestructura nueva puede leer, analizar, clasificar, probar sus contratos y escribir únicamente evidencia propia bajo `evidence/`.
- `PRODUCT_WRITE = DENIED`: no puede modificar HTML, V9, V10, ventas, inventario, caja, créditos ni tests funcionales del POS.
- No sustituye INFRA V2, no cambia autoridad, no inicia cutover ni Characterization.
- No requiere servidor, daemon, puerto fijo, PowerShell persistente ni agentes siempre activos.
- Toda ejecución es one-shot y recupera estado desde archivos durables, no desde memoria del modelo.

## Roles canónicos

- `planner`: READ-ONLY; produce Feature Spec, alcance, impacto y dependencias.
- `implementer`: WRITE limitado a infraestructura; en shadow mode no recibe autorización de escritura funcional.
- `tester`: TEST; ejecuta gates y pruebas sin alterar producto.
- `reviewer`: READ-ONLY; revisa riesgo, evidencia y gates.

Los archivos de rol no fijan modelos. `MANIFEST.yaml` y la política de routing seleccionan DeepSeek V4 Pro como primario, GLM 5.3 `reasoning=max` como segundo ingeniero condicional y Codex App como handoff externo forense/HIGH/CRITICAL/release.

## Flujo

`FEATURE_SPEC → IMPACT_ANALYSIS → DEPENDENCY_MAP → RISK → PREFLIGHT → RESOURCE_CHECK → ROUTING → STATE → EVIDENCE_PACK → NEXT_ACTION`

Toda causa desconocida o contradicción crítica escala. Resource/provider/tool failures no penalizan al modelo. Los estados terminales son inmutables y los retries requieren ciclo nuevo con evidencia nueva, máximo tres ciclos.

## Git y seguridad

Antes y después de cualquier cambio autorizado: `git status --short`, rama, diff, pruebas focalizadas y `git diff --check`. No usar `git add .`, `git add -A`, reset, clean, stash, restore, merge, rebase, push o force-push. No tocar cambios ajenos.
