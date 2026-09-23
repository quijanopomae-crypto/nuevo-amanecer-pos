# POS-LAB — copia segura para funciones nuevas

Este HTML es una copia experimental de `POS/index.html` y **no es CANON**.

## Abrir en Windows

Ejecuta:

```powershell
laboratorio\pos-lab\INICIAR_LAB.cmd
```

o:

```powershell
node laboratorio/pos-lab/server.mjs --open
```

URL LAB:

```text
http://127.0.0.1:8799/laboratorio/pos-lab/index.html
```

El POS canónico local usa otro origen (`127.0.0.1:8788`). Al cambiar de puerto, Chrome mantiene separado el almacenamiento del LAB.

## Qué puedes modificar

- `laboratorio/pos-lab/index.html`
- archivos nuevos dentro de `laboratorio/pos-lab/`
- otros experimentos bajo `laboratorio/experimentos/`

No edites `POS/index.html` mientras una función siga en prueba.

## Seguridad

- El LAB elimina cualquier credencial cloud recordada en su propio origen.
- Bloquea escrituras hacia el Worker cloud configurado actualmente.
- No registra el Service Worker canónico desde este HTML.
- No uses respaldos ni datos comerciales reales.
- Una función aprobada pasa a CANON como parche mínimo revisado, no copiando este HTML completo.

## Origen

- CANON source blob: `f2462f72953ce26c0ab79f2bd39f84f8b3ac8a7d`
- Archivo origen: `POS/index.html`
- Snapshot LAB: `laboratorio/pos-lab/index.html`
