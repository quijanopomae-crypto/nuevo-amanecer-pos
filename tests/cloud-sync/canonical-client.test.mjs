import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync('POS/js/sync/canonical-client.js','utf8');

test('canonical client reads all operational routes only through the existing read pipeline',()=>{
  for(const pair of [
    "['sales','sales']",
    "['sale-items','saleItems']",
    "['inventory-movements','inventoryMovements']",
    "['cash-movements','cashMovements']",
    "['cash-sessions', 'cashSessions']",
    "['financial-events', 'financialEvents']"
  ]) assert.ok(source.includes(pair),pair);
});

test('operational arrays survive replica cache round-trips without becoming required for old caches',()=>{
  for(const marker of ['replica.sales == null','replica.sale_items == null','replica.inventory_movements == null','replica.cash_movements == null']) assert.ok(source.includes(marker),marker);
  for(const marker of ['sales: copy(value.sales || [])','sale_items: copy(value.saleItems || [])','inventory_movements: copy(value.inventoryMovements || [])','cash_movements: copy(value.cashMovements || [])']) assert.ok(source.includes(marker),marker);
  for(const marker of ['sales: copy(replica.sales || [])','saleItems: copy(replica.sale_items || [])','inventoryMovements: copy(replica.inventory_movements || [])','cashMovements: copy(replica.cash_movements || [])']) assert.ok(source.includes(marker),marker);
});

test('operational history remains a read concern and adds no new commands',()=>{
  const commands=source.match(/var COMMANDS = \[([^\]]+)\]/)?.[1]||'';
  assert.doesNotMatch(commands,/sales\.read|cash\.read|inventory\.read/);
  assert.doesNotMatch(source,/createOperational|writeSaleHistory|writeCashHistory/);
});
