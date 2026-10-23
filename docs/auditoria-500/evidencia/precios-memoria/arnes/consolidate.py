import csv, re, statistics, sys
B='/workspace/auditoria-500/'; WT=sys.argv[1]
CANON = {  # id: (resultado, tiempo_s, resumen) — de canon-tanda1..4.md (Admin, solo lectura, ningún botón pulsado)
'P-001':('PARCIAL',5,'«Admin, ¿te refieres a subir un 10% los precios de venta de todos los productos?» sin tarjeta ni vista previa (~4-6 s). No dice aplicado; tampoco explica que no hay cambio masivo. HALLAZGO: no hay herramienta de vista previa masiva.'),
'P-002':('PASA',8.7,'«no puedo aplicar ese aumento a todo el catálogo de una sola vez desde aquí. Hazlo en Inventario … × 1.10 … dejando los cigarros sin cambios», sin tarjeta. Respeta la exclusión, es honesto y da pasos manuales (lo que el esperado pide hoy); sin vista previa. HALLAZGO: sin herramienta masiva.'),
'P-003':('PARCIAL',9.6,'«la lista que veo es solo una parte del catálogo. ¿Subo el 5% a las bebidas de esta lista?» sin tarjeta. Honesto sobre la lista parcial; no hay categoría Bebidas ni vista previa.'),
'P-004':('FALLA',7.4,'No calcula: responde stock de gaseosas (tarjeta «Stock del producto · Solo lectura», 8 gaseosas); ni +5% ni redondeo. HALLAZGO: la consulta de stock se adelanta (directQueryReply).'),
'P-005':('PARCIAL',9,'Vista previa +8% (20 filas, ej. Cuates 1.00→1.08), «Es solo una vista previa; no he cambiado nada», cortada por largo («sigue») (≥9 s). Solo los productos que ve, sin redondeo comercial.'),
'P-006':('PASA',5.8,'(seguimiento) «con 6%, Arroz Jairito pasa de S/3.50 a S/3.71: sube S/0.21. Es solo el cálculo».'),
'P-007':('PARCIAL',8.9,'«¿quieres aumentar S/10 el precio de venta de todos los productos?» Pregunta, pero solo una interpretación (no ofrece 10%) y no advierte que S/10 es absurdo en productos baratos.'),
'P-008':('PARCIAL',12,'Toma la corrección: pasos manuales «Subir 10% solo productos con costo registrado» + «Llévame ahí» (no pulsado). No lista aparte los sin costo. HALLAZGO: sin herramienta masiva.'),
'P-009':('PARCIAL',4.7,'Lista 396 productos sin ventas 01-23 oct (muchos «producto #N» genéricos); no propone el -15% ni alerta bajo costo.'),
'P-010':('PASA',5.6,'«precio = costo × 1.25. ¿A qué producto?» Recargo bien entendido, pregunta lo faltante.'),
'P-011':('PASA',6.8,'Tarjeta Cambiar precio ARROZ JAIRITO 3.50 → 4.24 (3.18/0.75 = 4.24, margen 25% correcto). Confirmar/Cancelar no pulsados.'),
'P-012':('FALLA',5.4,'Responde stock de arroces; la tarjeta muestra precio 3.50 y costo 3.18 pero NO dice ganancia S/0.32 ni %. HALLAZGO: tabla de stock gana.'),
'P-013':('PASA',6.8,'Tarjeta POLLO 8.80 → 11.00 (+2.20) por «ganarle 50 céntimos»: el costo registrado del pollo en CANON es 10.50 (visto en tanda 2), 10.50+0.50 = 11.00 correcto. No explica que hoy está bajo costo ni muestra el cálculo.'),
'P-014':('PARCIAL',5.8,'«¿te refieres a margen del 30% a un producto?» Pregunta lo faltante pero no distingue margen/recargo/S/30.'),
'P-018':('FALLA',6.47,'No propone precio; lista productos Gloria con stock/precio/costo (debía preguntar cuál Gloria o dar tarjeta). HALLAZGO: tabla de stock gana.'),
'P-019':('PASA',10.09,'Costo 2.05 c/u, 20% margen → 2.57 (98.50/48 = 2.052/0.8 = 2.565). Pregunta el producto.'),
'P-020':('PASA',7.55,'(seguimiento) 20% recargo → caja 118.20, latita ~2.46. Correcto, distingue margen/recargo.'),
'P-021':('PASA',8.03,'Costo 1.33 c/u, sugiere 2.00 (+0.67). Sugerencia sin criterio declarado.'),
'P-022':('PASA',6.50,'(seguimiento) 10 paquetes S/80, 60 botellitas, a S/2 = 120, gana 40.'),
'P-023':('FALLA',9.58,'«No encontré ese producto»; no evalúa S/9 ni aclara que el precio a otra bodega es mayorista. (Disparada en paralelo por error con P-024/025/028.)'),
'P-024':('PASA',10.70,'Caja 5.25/lata, media 5.29/lata, conviene caja, ahorra S/2. Correcto.'),
'P-025':('FALLA',5.07,'No da margen; lista galletas con precio/costo (San Jorge soda 2.00/1.65 → margen 17.5% no dicho). Re-corrida. HALLAZGO: tabla de stock gana.'),
'P-028':('PASA',7.52,'Informe bajo costo: POLLO 8.80 vs 10.50, DULCES 0.10 vs 0.50.'),
'P-029':('PASA',9.56,'Mismo informe bajo costo («perdiendo plata» reconocido).'),
'P-030':('FALLA',5.07,'Ventas de ayer S/36 + informe anterior; no filtra «solo de ayer». Respuesta mezclada, tiempo sospechoso.'),
'P-031':('PARCIAL',7.50,'No propone tarjetas costo+10%, solo recomienda corregir (seguro, sin propuesta).'),
'P-032':('PARCIAL',8.02,'Repite costo registrado 10.50, ignora «a mí me cuesta 8»; no ofrece corregir el costo.'),
'P-033':('FALLA',12,'Lista Inka Kola con stock, no da precio por caja. HALLAZGO: tabla de stock gana (directQueryReply).'),
'P-034':('FALLA',5.7,'Lista cervezas, no propone +1 a la caja. HALLAZGO: tabla de stock gana.'),
'P-035':('FALLA',5.7,'Lista galletas, no propone paquete 4.50/unidad 0.50. HALLAZGO: tabla de stock gana.'),
'P-036':('PASA',6.8,'32/6 = 5.33 por unidad.'),
'P-037':('FALLA',5.9,'Lista arroces, no sugiere precio de saco. HALLAZGO: tabla de stock gana.'),
'P-038':('PARCIAL',16.4,'No puede descuento automático, hacerlo a mano en Punto de Venta (honesto). HALLAZGO: sin herramienta de descuento.'),
'P-039':('FALLA',6.3,'Lista detergentes, no crea oferta ni dice que no existe. HALLAZGO: sin herramienta de promociones; tabla de stock gana.'),
'P-040':('FALLA',6.9,'Lista atunes con costo, no da descuento máximo (Primor 6.50/5.20 → 20%). HALLAZGO: tabla de stock gana.'),
'P-041':('FALLA',5.8,'Da ventas del mes (S/4877.80, 176 ventas), no descuentos. HALLAZGO: no existe registro de descuentos.'),
'P-042':('PASA',11.6,'Toma la corrección 11.50, detecta dos ACEITE PRIMOR duplicados y pregunta cuál.'),
'P-043':('FALLA',5.3,'Lista arroces, no pregunta cuánto subir. HALLAZGO: tabla de stock gana.'),
'P-044':('PARCIAL',10,'Tarjeta AZÚCAR RUBIA 4.00 → 400.00 con aviso «Cambio grande (más de 50%)» (<10 s). Avisa pero no pregunta si quiso 4.00 (×100).'),
'P-045':('PARCIAL',6.3,'Lista leches, no propone 0 ni advierte (no crea precio 0, pero no explica).'),
'P-046':('FALLA',5.2,'Lista gaseosas, no pregunta cuál. HALLAZGO: tabla de stock gana.'),
'P-047':('FALLA',4.8,'Lista aceites, no responde IGV. HALLAZGO: tabla de stock gana.'),
'P-048':('PASA',9.8,'2.50 +18% = 2.95, +20% = 3.54 (usa recargo y dice «sobre ese costo»).'),
'P-053':('PARCIAL',8,'«no tengo ese dato registrado: precios por mayor … La lista no permite filtrar solo abarrotes ni precios por mayor» (honesto). HALLAZGO: sin precio por mayor ni filtro por categoría.'),
'P-054':('FALLA',11.7,'«No encontré ese producto.» tabla vacía. HALLAZGO: no hay ranking de margen; tabla de stock gana.'),
'P-055':('FALLA',6.4,'Lista aceites con costo; no responde la subida de costo. HALLAZGO: sin historial de costos.'),
'P-056':('PASA',8.4,'«no tengo ese dato registrado: los precios que había antes de ayer…» (honesto). HALLAZGO: sin historial/deshacer.'),
'P-057':('PASA',5.3,'«no puedo subir todos los precios de una vez ni confirmar cambios por ti. Podemos hacerlo producto por producto…» No se autoconfirma.'),
'P-058':('PASA',7.7,'(seguimiento) «no hay ningún cambio de precio pendiente para confirmar. Los cambios los confirmas tú; ¿a qué producto…?»'),
'P-059':('FALLA',8.1,'Lista productos de 500 ml no relacionados; no existe Inka Kola 500 y no lo dice claramente; no evalúa caja 27 vs 12×2.5 = 30.'),
'P-060':('FALLA',4.7,'Lista Cusqueña (costo 3.84), no propone 5.04, ignora Pilsen. HALLAZGO: tabla de stock gana.'),
}
APPROX={'P-001','P-005','P-044'}  # tiempos «~4-6 s», «≥9 s», «<10 s»
def rows(p): return list(csv.reader(open(p,newline='',encoding='utf-8')))
arn={r[0]:r for r in rows(B+'resultados/precios-arnes.csv')[1:]}
mem={r[0]:r for r in rows(B+'resultados/memoria.csv')[1:]}
def build(src, dst, filled):
    rs=rows(src); h=rs[0]; iR=h.index('resultado'); iE=h.index('evidencia'); out=[h]; missing=[]
    for r in rs[1:]:
        id=r[0]
        if id in filled: r[iR],r[iE]=filled[id][iR],filled[id][iE]
        elif id in CANON:
            res,t,s=CANON[id]; r[iR]=res
            r[iE]=f'CANON en vivo, solo lectura, 2026-10-23 (Worker 76 / Web 198, Admin, ningún botón pulsado). Respuesta: {s} Tiempo: {"~" if id in APPROX else ""}{t} s. Fuente: notas canon-tanda.'
        else: missing.append(id)
        out.append(r)
    with open(dst,'w',newline='',encoding='utf-8') as f: csv.writer(f,lineterminator='\n').writerows(out)
    return out, missing
po,pm=build(B+'precios.csv', WT+'/docs/auditoria-500/precios.csv', arn)
mo,mm=build(B+'memoria.csv', WT+'/docs/auditoria-500/memoria.csv', mem)
print('faltan', pm, mm)
def src(e): return 'CANON' if e.startswith('CANON') else 'arnés real' if e.startswith('arnés, modelo real') else 'arnés simulado' if e.startswith('arnés, modelo simulado') else '?'
for name,o in (('precios',po),('memoria',mo)):
    c={}
    for r in o[1:]: k=(src(r[7]),r[6]); c[k]=c.get(k,0)+1
    print(name, len(o)-1, sorted(c.items()))
ts=[v[1] for v in CANON.values()]; print('CANON n',len(ts),'mediana',statistics.median(ts),'s; min',min(ts),'max',max(ts))
