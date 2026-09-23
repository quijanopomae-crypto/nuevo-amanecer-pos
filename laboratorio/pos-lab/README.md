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


## Estructura modular actual

```text
pos-lab/
├── sections/            # HTML por pantalla
├── styles/
│   ├── tokens.css
│   ├── components/      # botones, cards, tablas, forms, modales, navegación
│   └── pages/           # CSS por pantalla
├── animations/          # motion visual
├── js/motion/           # helpers de animación sin lógica comercial
├── UI_MAP.yaml          # mapa rápido para humanos e IA
├── LAB_TASK.example.json
├── scope-guard.mjs
├── build-lab.mjs
└── validate-lab.mjs
```

Para una tarea nueva, primero crea un contrato bajo `tasks/` y usa la allowlist más pequeña posible.

Validación completa:

```powershell
node laboratorio/pos-lab/validate-lab.mjs --task=laboratorio/pos-lab/tasks/<TAREA>.json
```


## Acceso directo desde celular

El POS-LAB puede abrirse como vista HTTPS estática directamente desde el repositorio, sin PC encendida, Node ni servidor local:

```text
https://raw.githack.com/quijanopomae-crypto/nuevo-amanecer-pos/feature/v1.3-mobile-cloud/laboratorio/pos-lab/index.html
```

Este enlace es exclusivamente LAB:
- no usar datos comerciales reales;
- no usar credenciales de producción;
- las escrituras al Worker cloud configurado permanecen bloqueadas por `lab-guard.js`;
- no se registra el Service Worker canónico;
- para producción se requiere un origen propio separado y controlado.

Las rutas del LAB son portables: el mismo HTML sigue funcionando con el servidor local de desarrollo.
