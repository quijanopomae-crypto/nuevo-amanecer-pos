# Primera tarea para Codex

Copia este texto en un hilo nuevo del proyecto:

```text
Lee AGENTS.md y todos los documentos de docs/ antes de modificar.

OBJETIVO
Auditar y estabilizar la versión principal del Sistema POS Nuevo Amanecer.

FASE 1 — CONFIRMACIÓN
1. Identifica el archivo o entrypoint principal.
2. Identifica commit, versión y estado de Git.
3. Crea un commit o rama de respaldo.
4. Describe la arquitectura y los comandos reales disponibles.
5. No inventes comandos, dependencias ni pruebas.

FASE 2 — AUDITORÍA
Busca:
- errores de sintaxis y ejecución;
- IDs, funciones y variables duplicadas;
- funciones sobrescritas;
- eventos inexistentes, duplicados o perdidos;
- ventas, cobros, movimientos de caja o descuentos de stock duplicables;
- inconsistencias entre venta, inventario y caja;
- pérdida de datos al recargar;
- configuraciones que no persisten;
- riesgos de inyección mediante innerHTML o importaciones;
- importaciones inseguras;
- acciones críticas sin validación;
- problemas responsive, scroll, caché y versiones antiguas.

Clasifica: Crítico, Alto, Medio, Bajo o Preventivo.

FASE 3 — PARCHES
Corrige de inmediato solo Crítico y Alto cuando el cambio sea localizado, verificable, no destructivo y no cambie reglas comerciales.

Detente antes de migraciones destructivas, borrado de datos, rediseño completo, backend o decisiones comerciales.

FASE 4 — PRUEBAS
Prueba como mínimo:
- crear y editar producto;
- añadir hasta diez códigos alternativos;
- guardar y recargar;
- registrar una venta una sola vez;
- doble clic en confirmar;
- descuento de stock;
- movimiento de caja;
- configuración persistente;
- scroll de modal;
- teléfono y computadora;
- consola sin errores nuevos.

FASE 5 — ISHIKAWA
Si el mismo patrón aparece dos veces o existe un bucle de regresión:
- congela cambios;
- define el problema central;
- formula hipótesis;
- ejecuta experimentos aislados;
- confirma causa raíz;
- aplica cinco porqués;
- cambia el proceso;
- crea prueba preventiva.

ENTREGA
- resumen ejecutivo;
- hallazgos;
- parches;
- archivos y funciones;
- pruebas realmente ejecutadas;
- patrones e Ishikawa, si aplica;
- cambio de proceso;
- riesgos pendientes;
- estado final.
```
