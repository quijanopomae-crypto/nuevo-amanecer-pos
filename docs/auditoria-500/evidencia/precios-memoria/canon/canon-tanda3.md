# CANON tanda 3 (P-033..P-048), 2026-10-23 ~15:43-15:47 UTC, Worker 76/Web 198, Admin, solo lectura, ningún botón pulsado
Patrón dominante (HALLAZGO): cuando la frase nombra un producto, la consulta de stock se adelanta y la respuesta es solo la tabla de stock (directQueryReply) -> P-033,034,035,037,039,040,043,045,046,047 (y P-018,P-025 de tanda 2).
P-033 ~12s: lista Inka Kola con stock, no da precio por caja. FALLA.
P-034 5.7s: lista cervezas, no propone +1 a la caja. FALLA.
P-035 5.7s: lista galletas, no propone paquete 4.50/unidad 0.50. FALLA.
P-036 6.8s: 32/6 = 5.33 por unidad. PASA.
P-037 5.9s: lista arroces, no sugiere precio de saco. FALLA.
P-038 16.4s: no puede descuento automático, hacerlo a mano en Punto de Venta. PARCIAL (honesto; sin herramienta de descuento - hallazgo).
P-039 6.3s: lista detergentes, no crea oferta ni dice que no existe. FALLA (sin herramienta de promociones - hallazgo).
P-040 6.9s: lista atunes con costo, no da descuento máximo (Primor 6.50/5.20 -> 20%). FALLA.
P-041 5.8s: da ventas del mes (S/4877.80, 176 ventas), no descuentos. FALLA (no existe registro de descuentos - hallazgo).
P-042 11.6s: toma la corrección 11.50, detecta dos ACEITE PRIMOR duplicados y pregunta cuál. PASA.
P-043 5.3s: lista arroces, no pregunta cuánto subir. FALLA.
P-044 <10s: tarjeta AZÚCAR RUBIA 4.00 -> 400.00 con aviso "Cambio grande (más de 50%)". PARCIAL: avisa pero no pregunta si quiso 4.00 (x100). Captura 2250d500...webp
P-045 6.3s: lista leches, no propone 0 ni advierte. PARCIAL (no crea precio 0, pero no explica).
P-046 5.2s: lista gaseosas, no pregunta cuál. FALLA.
P-047 4.8s: lista aceites, no responde IGV. FALLA.
P-048 9.8s: 2.50+18% = 2.95, +20% = 3.54. PASA (usa recargo, dice "sobre ese costo").
