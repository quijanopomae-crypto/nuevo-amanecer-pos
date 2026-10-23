# CANON tanda 1 (P-001..P-014), 2026-10-23 ~15:20-15:38 UTC, Worker 76 / Web 198, Admin, solo lectura, nada aplicado
Asistente se identifica "Burbuja · Gestión · Admin · prueba aislada". Tiempos aprox. Enter -> fin de "Pensando".
P-001 ~4-6s: "Admin, ¿te refieres a subir un 10% los precios de venta de todos los productos?" sin tarjeta.
P-002 ~8.7s: "no puedo aplicar ese aumento a todo el catálogo de una sola vez desde aquí. Hazlo en Inventario ... × 1.10 ... dejando los cigarros sin cambios." sin tarjeta.
P-003 ~9.6s: "la lista que veo es solo una parte del catálogo. ¿Subo el 5% a las bebidas de esta lista?" sin tarjeta.
P-004 ~7.4s: NO calcula; responde stock de gaseosas (tarjeta "Stock del producto · Solo lectura", 8 gaseosas). Falla: ni +5% ni redondeo.
P-005 >=9s: vista previa +8% (20 filas, ej Cuates 1.00->1.08), "Es solo una vista previa; no he cambiado nada", cortada por largo ("sigue"). Parcial: solo los productos que ve, sin redondeo comercial.
P-006 ~5.8s (seguimiento): "con 6%, Arroz Jairito pasa de S/3.50 a S/3.71: sube S/0.21. Es solo el cálculo". Pasa.
P-007 ~8.9s: "¿quieres aumentar S/10 el precio de venta de todos los productos?" sin advertir que es absurdo.
P-008 ~12s: pasos manuales "Subir 10% solo productos con costo registrado" + «Llévame ahí» (no pulsado). Entendió la corrección.
P-009 ~4.7s: lista 396 sin ventas 01-23 oct (muchos "producto #N" genéricos), no propone -15%.
P-010 ~5.6s: "precio = costo × 1.25. ¿A qué producto?" Pasa (recargo bien entendido, pregunta lo faltante).
P-011 ~6.8s: tarjeta Cambiar precio ARROZ JAIRITO 3.50 -> 4.24 (costo 3.18/0.75=4.24, margen 25% correcto). Confirmar/Cancelar no pulsados.
P-012 ~5.4s: responde stock de arroces; tarjeta muestra precio 3.50 costo 3.18 pero NO dice ganancia S/0.32 ni %. Falla.
P-013 ~6.8s: tarjeta POLLO 8.80 -> 11.00 (+2.20) por "ganarle 50 centimos". CORREGIDO tras tanda 2: costo registrado del pollo en CANON es 10.50, así que 10.50+0.50=11.00 es CORRECTO. PASA (pero no explica que el pollo hoy está bajo costo ni muestra el cálculo).
P-014 ~5.8s: "¿te refieres a margen del 30% a un producto?" pregunta lo faltante. Pasa parcial (no distingue margen/recargo).
Capturas: assets/480ac2a8...png (P-001), assets/bbb52958...png (P-012)
