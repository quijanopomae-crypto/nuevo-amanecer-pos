# Fotos por lote en CANON

Inventario → Cargar fotos acepta hasta 500 JPEG/PNG/WebP o un JSON versión 1 con `entries: [{codes: ["04692485"], image: "data:image/jpeg;base64,..."}]`. El nombre de cada foto debe ser un código exacto del producto, sin extensión. Los códigos siempre son texto. Nunca se vincula por nombre. Códigos ambiguos, productos repetidos, productos ausentes y fotos existentes se presentan en la vista previa; solo las filas Listas se guardan. Reemplazar requiere seleccionar de nuevo el lote.

Este catálogo visual vive en IndexedDB del dispositivo y origen, separado por promoción CANON. No sincroniza por el backend ni forma parte del backup comercial. Exportar lote permite respaldarlo y llevarlo a otro dispositivo. Deshacer restaura una vez el catálogo anterior. Borrar los datos del navegador elimina estas fotos; exportar antes.

READS: códigos y nombres actuales, imagen existente, permisos, promoción CANON. WRITES: únicamente la base IndexedDB `nuevo-amanecer-product-images-v1`. DOM: modal de fotos, tarjetas POS, carrito e inventario. No modifica productos, precios, stock, caja, ventas, códigos ni comandos CANON. Mantiene el overlay de imágenes existente como alternativa cuando no hay foto importada. Las escrituras verifican lectura posterior y comparan el registro anterior dentro de la transacción para evitar sobrescrituras entre pestañas.

Fotos individuales se convierten a JPEG de hasta 768 px; límite de 180000 caracteres por foto y 20 MB por catálogo. JSON exportado preserva bytes, valida formato y decodificación. La tabla usa textContent. El mismo módulo se incluye en el shell offline.

La descarga de las fotos de CasaMarket requiere una sesión autenticada vigente; este cambio no contiene fotos ni credenciales de CasaMarket.
