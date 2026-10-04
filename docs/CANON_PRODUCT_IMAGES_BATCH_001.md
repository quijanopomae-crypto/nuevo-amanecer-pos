# CANON Product Images — Batch 001

## Objective

Aplicar el primer lote de 10 imágenes de producto aprobadas por el owner al POS CANON sin modificar registros comerciales ni romper la inmutabilidad de D1.

## Scope

- Batch exacto de 10 productos ya revisados visualmente por el owner.
- Overlay estático CANON por coincidencia exacta de `product.name`.
- Las imágenes del lote 001 se resuelven desde URLs HTTPS exactas de fuentes previamente verificadas; no se modifica el producto para guardar esas URLs.
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

`producto CANON -> product.imagen raster válida ? product.imagen : overlay exact-name HTTPS permitido -> renderer`

El overlay no altera el objeto comercial ni se persiste mediante `saveAllData()`.

## Security invariants

- Solo se aceptan imágenes raster base64 ya permitidas o URLs `https://` cuyo hostname esté incluido explícitamente en el allowlist del resolver.
- `http://`, `javascript:`, `data:image/svg` y hosts no autorizados se rechazan.
- Las URLs se mantienen en un mapa exacto y versionado; no se aceptan URLs provenientes de datos comerciales o entrada de usuario.
- No se usa HTML inyectado para renderizar imágenes.
- Una coincidencia no exacta no obtiene imagen.
- Un producto con imagen propia válida no es sobrescrito.
- Un fallo de carga de la URL remota vuelve al icono del producto; no bloquea POS, carrito ni venta.

## Runtime risk

Las imágenes externas pueden cambiar o dejar de estar disponibles. Este lote prioriza aplicar las fotografías aprobadas sin alterar D1; una materialización posterior a assets locales puede eliminar esa dependencia manteniendo el mismo mapa de nombres.

## Tests

- El lote contiene exactamente 10 nombres únicos y las 10 URLs aprobadas.
- Todas las URLs son HTTPS y pertenecen al allowlist explícito.
- `product.imagen` raster válida tiene prioridad.
- Producto sin coincidencia exacta conserva fallback de icono.
- El renderer de tarjeta y carrito usa el resolver único.
- `POS/index.html` carga el overlay antes del resolver.
- El service worker precachea el archivo JS del overlay, no URLs externas.
- CANON Critical CI debe quedar verde antes de merge.

## Rollback

Revertir el commit/PR elimina el overlay; D1 queda idéntico porque esta tarea no ejecuta ninguna escritura de datos.
