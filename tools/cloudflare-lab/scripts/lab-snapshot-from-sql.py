#!/usr/bin/env python3
import argparse, json, sqlite3, hashlib, datetime

def load_json(value):
    try:
        out=json.loads(value) if value else {}
        return out if isinstance(out, dict) else {}
    except Exception:
        return {}

def table_exists(db,name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None

def active_promotion(db):
    if table_exists(db,'canonical_control'):
        row=db.execute("SELECT active_promotion_id FROM canonical_control WHERE id=1").fetchone()
        if row and row[0]: return str(row[0])
    if table_exists(db,'canonical_promotions'):
        row=db.execute("SELECT promotion_id FROM canonical_promotions WHERE status='COMMITTED' ORDER BY committed_at DESC, created_at DESC LIMIT 1").fetchone()
        if row: return str(row[0])
    raise RuntimeError("No active/committed canonical promotion found")

def cents(v):
    return round((v or 0)/100,2)

def iso_day_name(date_text):
    if not date_text: return ""
    try:
        d=datetime.datetime.fromisoformat(str(date_text).replace('Z','+00:00'))
        return ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"][d.weekday()]
    except Exception:
        return ""

def get_rows(db,table,promotion):
    if not table_exists(db,table): return []
    return [dict(r) for r in db.execute("SELECT * FROM "+table+" WHERE promotion_id=? ORDER BY 1", (promotion,))]

def snapshot_from_db(db):
    db.row_factory=sqlite3.Row
    promotion=active_promotion(db)

    products=[]
    for r in get_rows(db,'products',promotion):
        p=load_json(r.get('source_payload_json'))
        p.setdefault('id',r.get('product_id'))
        p.setdefault('nombre',r.get('name'))
        if 'stock' not in p: p['stock']=r.get('current_stock_quantity') or 0
        if 'precio' not in p and r.get('price_cents') is not None: p['precio']=cents(r.get('price_cents'))
        if 'costo' not in p and r.get('cost_cents') is not None: p['costo']=cents(r.get('cost_cents'))
        products.append(p)

    customers=[]
    for r in get_rows(db,'customers',promotion):
        p=load_json(r.get('source_payload_json'))
        p['id']=p.get('id') or r.get('customer_id')
        p['nombre']=p.get('nombre') or p.get('name') or r.get('name') or 'Cliente'
        if not p.get('dni') and r.get('document'): p['dni']=r.get('document')
        if not p.get('telefono') and r.get('phone'): p['telefono']=r.get('phone')
        customers.append(p)

    payments_by_credit={}
    for r in get_rows(db,'credit_payments',promotion):
        p=load_json(r.get('source_payload_json'))
        credit_id=str(r.get('credit_id'))
        p['id']=p.get('id') or p.get('pagoId') or r.get('source_payment_id') or r.get('payment_id')
        p['pagoId']=p.get('pagoId') or p['id']
        p['creditoId']=p.get('creditoId') or credit_id
        p['monto']=p.get('monto') if p.get('monto') is not None else cents(r.get('amount_cents'))
        if not p.get('fecha') and r.get('payment_date'): p['fecha']=r.get('payment_date')
        if not p.get('timestamp') and r.get('payment_timestamp'): p['timestamp']=r.get('payment_timestamp')
        if not p.get('metodo') and r.get('method'): p['metodo']=r.get('method')
        if not p.get('operacion') and r.get('source_operation_reference'): p['operacion']=r.get('source_operation_reference')
        if not p.get('numeroOperacion') and p.get('operacion'): p['numeroOperacion']=p.get('operacion')
        if not p.get('referencia') and p.get('operacion'): p['referencia']=p.get('operacion')
        if not p.get('diaSemana') and (p.get('timestamp') or p.get('fecha')): p['diaSemana']=iso_day_name(p.get('timestamp') or p.get('fecha'))
        if r.get('source_balance_after_cents') is not None:
            p.setdefault('saldoActual',cents(r.get('source_balance_after_cents')))
            p.setdefault('saldoAnterior',round(p['saldoActual']+float(p['monto'] or 0),2))
        payments_by_credit.setdefault(credit_id,[]).append(p)

    credits=[]
    for r in get_rows(db,'credits',promotion):
        p=load_json(r.get('source_payload_json'))
        cid=str(r.get('credit_id'))
        p['id']=p.get('id') or cid
        p['cliId']=p.get('cliId') or p.get('cliente_id') or r.get('customer_id')
        p['monto']=p.get('monto') if p.get('monto') is not None else cents(r.get('original_amount_cents'))
        p['pagado']=p.get('pagado') if p.get('pagado') is not None else cents(r.get('import_paid_cents'))
        p['saldo']=p.get('saldo') if p.get('saldo') is not None else cents(r.get('current_balance_cents'))
        p['fecha']=p.get('fecha') or r.get('issued_value') or ""
        p['vence']=p.get('vence') or r.get('due_value') or ""
        p['desc']=p.get('desc') or r.get('concept') or r.get('reference') or 'Crédito'
        p['pagos']=payments_by_credit.get(cid,[])
        credits.append(p)

    return {
      "version":9,
      "updatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
      "appConfig":{},
      "ui":{"currentPage":"pageMenu","isDark":False,"currentCfgCategory":"negocio"},
      "locks":{"master":False,"readOnly":False,"modules":{}},
      "data":{
        "productos":products,
        "ventas":[],
        "clientes":customers,
        "creditos":credits,
        "gastos":[],
        "cajMovs":[],
        "cajEstado":{},
        "cashClosures":[],
        "inventoryMovements":[]
      },
      "cart":[],
      "draft":None
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--sql',required=True)
    ap.add_argument('--output',required=True)
    args=ap.parse_args()
    sql=open(args.sql,'r',encoding='utf-8').read()
    db=sqlite3.connect(':memory:')
    try:
        db.executescript(sql)
        check=db.execute("PRAGMA integrity_check").fetchone()
        if not check or check[0]!="ok": raise RuntimeError("SQLite integrity_check failed")
        snapshot=snapshot_from_db(db)
    finally:
        db.close()
    raw=json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))
    with open(args.output,'w',encoding='utf-8') as fh: fh.write(raw)
    print(json.dumps({
      "clientes":len(snapshot["data"]["clientes"]),
      "creditos":len(snapshot["data"]["creditos"]),
      "pagos":sum(len(c.get("pagos",[])) for c in snapshot["data"]["creditos"]),
      "productos":len(snapshot["data"]["productos"]),
      "snapshot_sha256":hashlib.sha256(raw.encode()).hexdigest()
    }))

if __name__=="__main__":
    main()
