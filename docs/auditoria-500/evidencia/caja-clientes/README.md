# Evidencia caja.csv + clientes-creditos.csv (Nuevo Bot)

- Fecha: 2026-10-23. Rama `audit/asistente-500` @ 49b06c23.
- Ruta: `assistantChatRoute` real de `tools/cloudflare-lab/src/pos-assistant.js` ejecutado en Node, **modelo real** ohmyagent `gpt-6.1-sol` (clave ya inyectada en el entorno, no se muestra), base **simulada** con `memoryReader` (`_datos-simulados.json`). Nada contra CANON ni su base; ninguna acción aplicada.
- Por qué no CANON/lab: el Worker lab/staging no tiene la ruta del asistente (404); CANON pide sesión (401) y es solo lectura.
- El aparato se simula con `maskCustomers` (Admin). Empleados: rol por la nota «(empleado nivel N)», que se quita antes de enviar.
- CAJ-015 corre con caja cerrada; el resto con caja abierta (fondo S/ 100, esperado S/ 269.10).
- Cada `<ID>.json`: pregunta, texto enviado, HTTP, ms, respuesta, propuestas, llamadas al modelo (prompt de sistema solo como longitud). Nombres de clientes (inventados) redactados como `[nombre]`.
- CLI-029: el proveedor devolvió 400 `content_filter` en 3 intentos (2 corridas) → 502 `upstream_error`.
