# Autorizacion de publicacion: fotos en WORK

Objetivo: habilitar una imagen por mensaje en el chat WORK, usando la ruta de vision ya implementada en CANON.

- Correccion aprobada: PR #1096, commit `f45c64332377d1c5aa00575b23dbb1a678a1f093`.
- Archivos ejecutables autorizados: `POS/js/work-host.js`, `POS/work/index.html` y `POS/work/work-canon-bridge.js`.
- Acceso: solo Admin con vision disponible. Validaciones de formato y tamaño en cliente y servidor.
- No autoriza cambios en la base de datos, ventas, inventario, permisos ni Worker.
- La publicacion se detiene si `verify-direct` no acredita el alcance y el estado del despliegue.
- Esta nota registra la mision; **no** acredita que produccion se haya actualizado.
