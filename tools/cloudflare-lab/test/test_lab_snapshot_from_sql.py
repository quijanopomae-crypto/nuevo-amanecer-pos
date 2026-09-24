import json, os, subprocess, tempfile, unittest

SCRIPT=os.path.join(os.path.dirname(__file__),'..','scripts','lab-snapshot-from-sql.py')

SQL=r'''
PRAGMA foreign_keys=OFF;
CREATE TABLE canonical_control(id INTEGER PRIMARY KEY, active_promotion_id TEXT);
CREATE TABLE canonical_promotions(promotion_id TEXT PRIMARY KEY,status TEXT,committed_at TEXT,created_at TEXT);
CREATE TABLE products(promotion_id TEXT, product_id TEXT, name TEXT, current_stock_quantity REAL, price_cents INTEGER, cost_cents INTEGER, source_payload_json TEXT);
CREATE TABLE customers(promotion_id TEXT, customer_id TEXT, name TEXT, document TEXT, phone TEXT, source_payload_json TEXT);
CREATE TABLE credits(promotion_id TEXT, credit_id TEXT, customer_id TEXT, original_amount_cents INTEGER, import_paid_cents INTEGER, current_balance_cents INTEGER, issued_value TEXT, due_value TEXT, concept TEXT, reference TEXT, source_payload_json TEXT);
CREATE TABLE credit_payments(promotion_id TEXT, payment_id TEXT, credit_id TEXT, source_payment_id TEXT, amount_cents INTEGER, payment_date TEXT, payment_timestamp TEXT, method TEXT, source_operation_reference TEXT, source_balance_after_cents INTEGER, source_payload_json TEXT);
INSERT INTO canonical_control VALUES(1,'P1');
INSERT INTO canonical_promotions VALUES('P1','COMMITTED','2026-09-23T08:00:00Z','2026-09-23T07:00:00Z');
INSERT INTO products VALUES('P1','PR1','Producto',5,1000,700,'{"id":"PR1","nombre":"Producto"}');
INSERT INTO customers VALUES('P1','C1','Cliente Uno','12345678','999999999','{"id":"C1","nombre":"Cliente Uno"}');
INSERT INTO credits VALUES('P1','CR1','C1',10000,2500,7500,'2026-09-01','2026-10-01','Compra','R1','{"id":"CR1","cliId":"C1","desc":"Compra"}');
INSERT INTO credit_payments VALUES('P1','PAY1','CR1','PAY1',2500,'2026-09-10','2026-09-10T15:30:00Z','efectivo','OP1',7500,'{"id":"PAY1","monto":25}');
'''

class ConverterTest(unittest.TestCase):
    def test_sql_backup_becomes_pos_snapshot(self):
        with tempfile.TemporaryDirectory() as td:
            sql=os.path.join(td,'backup.sql')
            out=os.path.join(td,'snapshot.json')
            open(sql,'w',encoding='utf-8').write(SQL)
            run=subprocess.run(['python3',SCRIPT,'--sql',sql,'--output',out],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            snap=json.load(open(out,encoding='utf-8'))
            self.assertEqual(snap['version'],9)
            self.assertEqual(len(snap['data']['clientes']),1)
            self.assertEqual(len(snap['data']['creditos']),1)
            cr=snap['data']['creditos'][0]
            self.assertEqual(cr['cliId'],'C1')
            self.assertEqual(cr['monto'],100.0)
            self.assertEqual(cr['pagado'],25.0)
            self.assertEqual(cr['saldo'],75.0)
            self.assertEqual(len(cr['pagos']),1)
            self.assertEqual(cr['pagos'][0]['monto'],25)
            self.assertEqual(snap['data']['productos'][0]['stock'],5)

if __name__=='__main__':
    unittest.main()
