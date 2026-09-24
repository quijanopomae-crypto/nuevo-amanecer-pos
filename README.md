# POS Nuevo Amanecer

## Estado actual

**Producción estable:** `v1.2-production`.

**Línea activa del repositorio:** V1.3 en integración/remediación sobre `feature/v1.3-mobile-cloud`.

V1.3 todavía no equivale a un cutover de producción. Los gates locales, migraciones versionadas, LAB, backups y código dormido no autorizan por sí solos un deploy remoto ni el modo comercial `ACTIVE`.

Fuentes rápidas:

- Estado V1.3 actual: [docs/V1.3_STATUS.md](docs/V1.3_STATUS.md)
- Mapa corto del repositorio: [REPO_MAP.yaml](REPO_MAP.yaml)
- Reglas de trabajo y zonas: [AGENTS.md](AGENTS.md)
- Reglas funcionales del producto: [AGENTS_Nuevo_Amanecer.md](AGENTS_Nuevo_Amanecer.md)
- Roles OpenCode: [.opencode/ROLE_MAP.md](.opencode/ROLE_MAP.md)
- Contrato LAB -> CANON: [docs/LABORATORIO_A_CANON.md](docs/LABORATORIO_A_CANON.md)
- Espejo CANON -> R2 -> D1 LAB: [docs/LAB_CANON_MIRROR.md](docs/LAB_CANON_MIRROR.md)

## Zonas

| Zona | Rol |
| --- | --- |
| `POS/` | CANON del producto |
| `laboratorio/pos-lab/` | LAB de UI/funciones; no es CANON |
| `tools/cloudflare-lab/` | Worker, D1 y herramientas de infraestructura LAB |
| `tools/cloudflare-backup/` | backup/recovery |
| `tests/` | regresiones de producto, cloud-sync, infraestructura y seguridad |
| `.opencode/` | agentes y comandos |
| `.agents/skills/` | skills canónicas |
| `evidence/` | evidencia histórica/de tareas; no asumir que describe el HEAD actual |

`MANIFEST.yaml` y `orchestrator/` pertenecen al modo SHADOW legacy. No son gates automáticos para trabajo normal de CANON/LAB salvo invocación explícita.

## Ejecutar el POS estable local

En Windows con Node.js:

```powershell
INICIAR_POS.cmd
```

El iniciador abre:

```text
http://127.0.0.1:8788/POS/index.html
```

Inicio manual:

```powershell
node tools/pos-local/server.mjs
```

Prueba focal del servidor local:

```powershell
node --test tests/release-local-server.test.mjs
```

No cambiar el origen de una caja existente sin exportar y comprobar antes el respaldo completo. El repositorio no debe contener datos comerciales reales ni valores de credenciales.

## LAB móvil

El LAB se abre localmente desde `laboratorio/pos-lab/` y puede publicarse como vista LAB por GitHub Pages. El Pages build no sirve el `POS/index.html` canónico como aplicación de producción.

Los datos comerciales reales, cuando se usan para pruebas autorizadas, solo pueden existir como copia aislada en D1 LAB mediante el flujo documentado CANON -> backup R2 -> D1 LAB. Nunca se incrustan en Git, HTML, fixtures o evidence.

## V1.3 y documentación histórica

Los documentos `V1.3_A2...` a `V1.3_A6...`, los informes de remediación, snapshots y evidence registran gates concretos. Son evidencia útil, pero pueden contener SHAs, conteos o estados válidos únicamente para aquel momento.

Antes de actuar sobre ellos, consulta [docs/V1.3_STATUS.md](docs/V1.3_STATUS.md) y el HEAD real de GitHub.

La migración/reconciliación A5 continúa documentada en [docs/V1.3_A5_MIGRATION_RECONCILIATION.md](docs/V1.3_A5_MIGRATION_RECONCILIATION.md). Sus fuentes privadas se colocan en `tools/cloudflare-lab/private/a5-inputs/`, ignoradas por Git. A5 no despliega ni promueve datos comerciales por sí sola.
