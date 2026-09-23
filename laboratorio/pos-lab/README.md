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


## Edición modular

`index.html` es ahora la salida generada del LAB. No lo edites directamente para cambios de pantalla.

Edita la sección concreta en:

```text
sections/menu.html
sections/punto-venta.html
sections/inventario.html
sections/clientes.html
sections/caja.html
sections/ventas.html
sections/gastos.html
sections/configuracion.html
```

Después reconstruye:

```powershell
node laboratorio/pos-lab/build-lab.mjs
node laboratorio/pos-lab/build-lab.mjs --check
```

Para encontrar rápidamente qué archivo corresponde a una pantalla, componente o animación, consulta `UI_MAP.yaml`.

Regla: extracción ≠ reescritura. Las secciones iniciales fueron extraídas exactamente del HTML LAB congelado; modularizar no autoriza cambios funcionales.
