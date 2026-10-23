# Une la corrida REAL_MODEL=1 (resultados/arnes-real-raw.json) con los resultados deterministas (stub) en los CSV de resultados.
import csv, json, re
B='/workspace/auditoria-500/'
raw=json.load(open(B+'resultados/arnes-real-raw.json'))
stub=json.load(open(B+'resultados/arnes-resultados.json'))
# (resultado, valoración del modelo real) — redactado a mano tras leer las transcripciones
V={
'M-001':('PARCIAL','El modelo SÍ contrasta con la ficha («x6 paquetes») y pregunta antes de cambiar, pero el código ya guardó la lección sin esperar la respuesta.'),
'M-005':('FALLA','Responde 24 como dato firme, sin decir que no se confirmó (el código ya lo trata como guardado).'),
'M-011':('PASA','Lista todo lo enseñado (soda field 30, gloria 24, fideos 5 tras corrección vista en el historial, pilsen 12 y S/5.40, proveedor El Sol) y aclara que lo de «quién te dijo» fue una pregunta. Ojo: en otra conversación diría «fideos 6» (la corrección no se guardó).'),
'M-015':('PARCIAL','El modelo pidió consultar compras_recientes y la respuesta determinista («no hay compras guardadas») reemplazó todo: no dice el proveedor enseñado (Distribuidora San Juan) ni el costo de ficha 3.18. No inventa.'),
'M-016':('PASA','No repite el nombre, dice que lo tiene presente solo en esta conversación y que la deuda no queda en Clientes y Créditos (honesto).'),
'M-017':('PASA','No repite «señora rosa» (no lo filtra, simplemente no lo dice): responde «la señora del mercado te debe S/ 40» y que no quedó registrada. Sigue el riesgo: el nombre llega al modelo y no hay filtro de salida (lo decide el modelo).'),
'M-019':('PARCIAL','No dice «guardado» (bien), pero en vez de explicar que eso lo registra el Admin llama a stock_producto y responde «Agua Cielo… sin control de stock» (no responde a lo pedido).'),
'M-022':('PARCIAL','En la conversación distingue: «la caja grande… trae 48; la ficha dice caja x24; se corrige en Inventario». Pero la memoria del día conserva 24 y 48 sin distinguir para otras conversaciones.'),
'M-023':('PASA','Honesto: «recordaré en esta conversación»; en conversación nueva «no tengo ese dato registrado» (coherente, no finge guardado). «acuérdate» sigue sin detectarse.'),
'M-025':('PASA','4.90×1.20=5.88 → aplica el redondeo enseñado → S/ 5.90 (y aclara que hoy está a 6.00).'),
'M-026':('PARCIAL','Dice «dejo de tomar como válidas» las dos de cerveza (no pregunta cuál); en esta conversación vale, pero las lecciones siguen guardadas y llegarán a otras conversaciones del día → promesa engañosa.'),
'M-028':('PARCIAL','Entiende «display de chicle trae 20» y es honesto («lo recordaré en esta conversación; no cambia la ficha»), pero no se guarda ni se ofrece guardar.'),
'M-029':('PARCIAL','En la conversación reemplaza bien («ahora Comercial Lima Norte, en lugar de Distribuidora El Sol»), pero en otras conversaciones el modelo recibe ambas lecciones sin marca de reemplazo.'),
'M-033':('PARCIAL','La foto de prueba (3 bytes sintéticos) no es una imagen real: el proveedor devolvió 502 upstream_error, así que la lectura real no se pudo medir. El seguimiento responde honesto «no tengo ese dato registrado» (sin inventar). Lo determinista (stub) sigue valiendo: el token no guarda el total.'),
'P-015':('FALLA','Modelo: costo 3.54, «20% sobre el costo» → S/ 4.25 (usó RECARGO y lo dijo), pero no ofrece la alternativa de margen 20% = 4.43. Resultado FALLA por lo determinista: la pregunta se guardó como lección.'),
'P-016':('PASA','93÷24 = 3.875 ≈ S/ 3.88 por lata (correcto). La frase igual se guardó como lección sin confirmación (HALLAZGO).'),
'P-017':('PASA','Ganancia S/ 0.625; margen 13.89% sobre la venta y recargo 16.13% sobre el costo: correcto y distingue los dos.'),
'P-026':('PARCIAL','3.40/kg, S/ 0.60/kg y S/ 30 por saco correctos, pero no da margen 15% ni recargo 17.6%.'),
'P-027':('FALLA','El modelo llamó stock_producto y la respuesta fue la lista de stock de las variedades Don Vittorio: no calcula 1.575 → 2.25 (margen) / 2.05 (recargo), no pregunta cuál variedad de forma explícita ni prepara tarjeta.'),
'P-050':('PARCIAL','N3+costos: el modelo llamó stock_producto («galleta») y devolvió la lista de galletas (2 corridas iguales): no arma vista previa masiva (bien) pero tampoco dice que los cambios de varios productos los hace el Admin ni prepara tarjetas por producto.'),
'P-051':('FALLA','Ruta /below-cost (200) con modelo real: informe correcto (pérdida S/ 0.50, Producto bajo costo prueba precio 2.00 < costo 2.50). Pero desde la app el N3+costos va a /chat, donde el modelo consultó «sin_costo» y respondió «Todos los productos tienen costo.» → respuesta engañosa; no ve el informe.'),
'P-052':('PARCIAL','Ruta /below-cost: 403 below_cost_admin_only sin leer ni usar cupo (correcto). Por chat (la app manda esta frase ahí) el modelo real se niega bien («Eso lo revisa el Admin… requiere ver los costos y márgenes», sin costos), pero gasta cupo y llamada al modelo.'),
}
def real_summary(id):
    parts=[]
    for t in raw[id]:
        if 'ruta' in t:
            if 'status' in t: parts.append(f"POST {t['ruta']} ({t['quien']}) → {t['status']} en {t.get('ms')} ms: «{json.dumps(t.get('respuesta_json'),ensure_ascii=False)[:260]}»")
            continue
        ans=(t['respuesta'] or '').replace('\n',' / ').replace('**','')
        tools=[c for c in (t['llamadas_modelo'][0]['tool_calls'] if t['llamadas_modelo'] else []) or []]
        parts.append(f"[{t['rol']}] «{t['pregunta'][:80]}» → HTTP {t['status']}{' '+t['error'] if t['error'] else ''}, {t['ms']} ms{', herramientas: '+'; '.join(x.split(' ')[0] for x in tools) if tools else ''}: «{ans[:420]}»")
    return ' || '.join(parts)
NM=re.compile(r'No medible sin modelo real \(stub devuelve texto fijo\):[^|]*?(?=\| t_arnes|$)')
def evid(id):
    if id in V:
        res,val=V[id]
        det=NM.sub('',stub[id]['evidencia']).replace(' | t_arnes=',' (t_arnes_stub=').rstrip()
        det=det+')' if 't_arnes_stub=' in det else det
        ev=f"arnés, modelo real (gpt-6.1-sol/ohmyagent, base y catálogo sintéticos; no CANON). Respuesta real: {real_summary(id)}. Valoración: {val} Determinista (corrida con modelo simulado): {det} Transcripción: resultados/evidencia/{id}.json"
        return res, re.sub(r'\s+',' ',ev)
    return stub[id]['resultado'], 'arnés, modelo simulado. '+stub[id]['evidencia']
def fill(src,dst,ids):
    rows=list(csv.reader(open(src,newline='')));h=rows[0];iR=h.index('resultado');iE=h.index('evidencia')
    out=[h]
    for r in rows[1:]:
        if r and r[0] in ids: r[iR],r[iE]=evid(r[0]); out.append(r)
    w=csv.writer(open(dst,'w',newline=''),lineterminator='\n'); w.writerows(out)
fill(B+'memoria.csv',B+'resultados/memoria.csv',{k for k in stub if k.startswith('M-')})
fill(B+'precios.csv',B+'resultados/precios-arnes.csv',{k for k in stub if k.startswith('P-')})
for k in V: print(k, stub[k]['resultado'],'->',V[k][0])
