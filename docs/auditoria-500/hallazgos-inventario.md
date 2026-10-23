# Hallazgos: inventario (INV-001..INV-065)

Resultados en `inventario.csv`. Evidencia: `evidencia/inventario/INV-0xx.json` (arnés, modelo real, base `0914ee23`, datos sintéticos) y `evidencia/inventario/canon/canon-inventario-1..3.md` (CANON solo lectura, Worker 76 / Web 198, Admin, ningún botón pulsado).

Totales: CANON 35 → 15 PASA, 9 PARCIAL, 11 FALLA. Arnés 30 → 18 PASA, 11 PARCIAL, 1 FALLA. Las 65 → 33 PASA, 20 PARCIAL, 12 FALLA.

| # | Hallazgo | Casos | Dueño / arreglo |
|---|---|---|---|
| H1 | `directQueryReply`: si el modelo solo pide stock, el servidor devuelve la tabla de stock como respuesta completa y no vuelve a llamar al modelo; se pierden preguntas (cuál producto), avisos y explicaciones (pos-assistant.js:3340-3342, :3040). En CANON el mismo patrón: tabla, tarjeta de documento o resumen de ventas en vez de la cifra pedida. | INV-012, 026, 029, 030, 033, 039; CANON 011, 014, 016-019, 022, 023, 025, 050, 052 | Autor de caja (CLI-029), sumar casos INV a sus pruebas |
| H2 | Falso «Sin tarjeta todavía»: `adjustRequests` toma cada trozo después de una coma que tenga un dígito como un producto aparte (p. ej. «ponlo en 0») (pos-assistant-varios.js:40-46). | INV-045 | Autor de #986, `fix/asist-ajuste-coma` |
| H3 | «Fideo Don [nombre oculto]»: `maskReplyPeople` toma «Don» de una marca como trato de persona (pos-assistant.js:2557-2566). | INV-041 (y UNI-058) | Autor de #987, `fix/asist-nombre-producto-don` |
| H4 | Sin tope de tarjetas: «súmale 10 a todo» llegó a sacar 19 tarjetas de ajuste a la vez; solo lo frena la regla del prompt (MULTI_ADJUST_RULE). | INV-057 (FALLA) | Autor de #986, mismo PR que H2: tope de 5 tarjetas en el servidor; si son más, ninguna tarjeta y una pregunta con el número real |
| H5 | Si el proveedor rechaza por `content_filter` (HTTP 400), el usuario recibe un 502 `upstream_error` genérico, sin texto claro (pos-assistant.js:2962). | INV-065 | Autor de caja |

## Otros hallazgos

- **Negativa a borrar:** al pedir borrar un producto, responde con el texto de reinicio («Eso necesita la clave del Admin», RESET_REFUSAL_TEXT) incluso al propio Admin, en vez de decir que no hay herramienta para borrar productos (INV-059).
- **UI, texto viejo tras «Nueva conversación»:** la respuesta anterior sigue visible en el panel (más una línea fija al pie) o, al menos, en el `innerText` (probable live-region oculta). El hilo enviado sí empieza limpio (CANON tandas 1-3; INV-009 repitió el texto de INV-008).
- **Datos de CANON:** mínimo 0 en todos los productos vistos y stock negativo generalizado (VERDURAS -7660, VARIOS -2473, PAN -257, azúcar -54…). «En o bajo el mínimo» da 312 y pone los genéricos negativos como urgentes (INV-009, INV-046). Hay productos duplicados (INV-011).
- **Herramientas que faltan:** cambiar el mínimo de un producto existente, historial de movimientos (entradas/salidas), informe de merma, vencimientos, ajuste masivo con vista previa, borrar producto, motivo «robo» en los ajustes.
- **INV-027:** el texto al Admin dice «producto #N» en lugar del nombre; la tarjeta debajo sí muestra los nombres.
- **INV-047 / INV-053:** ignoran la marca pedida (no dice que no hay Lavaggi) y la palabra «caja» / «grande» (lista leches Gloria sin hablar de cajas).

## Privacidad

Antes del commit se buscó en todo lo añadido la clave del proveedor (completa, primeros 12 y últimos 12 caracteres), prefijos de clave y encabezados de autenticación, y nombres de clientes reales. Ver informe del commit.
