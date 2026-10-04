# CANON Product Images — Batch 001

## Objective

Aplicar el primer lote de 10 imágenes de producto aprobadas por el owner al POS CANON sin modificar registros comerciales ni romper la inmutabilidad de D1.

## Scope

- Batch exacto de 10 productos ya revisados visualmente por el owner.
- Overlay estático CANON por coincidencia exacta de `product.name`.
- Imágenes optimizadas y versionadas bajo `POS/assets/product-images/b001/`.
- El campo `product.imagen` existente conserva prioridad cuando contiene una imagen raster `data:` válida.
- Si `product.imagen` está vacío, el renderer puede resolver una imagen del overlay por nombre exacto.
- No se modifica D1, precio, costo, stock, categoría, código, historial, ventas ni provenance.
- No se escribe `laboratorio/**` ni `tools/cloudflare-lab/**` mientras LAB está congelado.

## Batch 001

1. `TRULULU AROS 90GR`
2. `TRULULU FRESITAS 90GR`
3. `TRULULU ORO 90GR`
4. `TRULULU SABORES 90GR`
5. `TRULULU DINOS 90GR`
6. `GOMITAS TRULULU SABORES 90 GR`
7. `GOMAS TRULULU DINOSS 90G*`
8. `TRULULU CASQUITOS VITAMINA C 90GR`
9. `TRULULU PINGUINOS 80GR`
10. `TRULULU SNACKS OSOS ORO 80G`

## Data flow

`producto CANON -> product.imagen válido ? product.imagen : overlay exact-name -> renderer`

El overlay no altera el objeto comercial ni se persiste mediante `saveAllData()`.

## Security invariants

- Solo se aceptan rutas locales versionadas dentro de `assets/product-images/` o imágenes raster base64 ya permitidas.
- Ninguna URL externa queda en runtime.
- No se usa HTML inyectado para renderizar imágenes.
- Una coincidencia no exacta no obtiene imagen.
- Un producto con imagen propia válida no es sobrescrito.

## Tests

- El lote contiene exactamente 10 nombres únicos.
- Cada nombre resuelve a un asset local existente.
- No se permiten `http://`, `https://`, `javascript:`, `data:image/svg` ni paths fuera de `assets/product-images/` en el overlay.
- `product.imagen` raster válida tiene prioridad.
- Producto sin coincidencia exacta conserva fallback de icono.
- El renderer de tarjeta y carrito usa el resolver único.
- CANON Critical CI debe quedar verde antes de merge.

## Rollback

Revertir el commit/PR elimina el overlay y sus assets; D1 queda idéntico porque esta tarea no ejecuta ninguna escritura de datos.
