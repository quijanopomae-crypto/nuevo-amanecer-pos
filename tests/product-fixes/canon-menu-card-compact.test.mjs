import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('POS/css/base.css','utf8');

test('mobile main menu cards are approximately 10 percent more compact',()=>{
  const mobileStart=css.indexOf('@media(max-width:480px)');
  assert.ok(mobileStart>=0,'missing mobile breakpoint');
  const mobile=css.slice(mobileStart,mobileStart+5000);
  assert.match(mobile,/\.modules-grid\{grid-template-columns:repeat\(2,1fr\);gap:9px\}/);
  assert.match(mobile,/#pageMenu \.module-card\{border-radius:18px;padding:16\.2px 14\.4px 14\.4px;gap:9\.9px\}/);
  assert.match(mobile,/#pageMenu \.module-icon\{width:57\.6px;height:57\.6px;border-radius:18px;font-size:27\.9px\}/);
  assert.match(mobile,/#pageMenu \.module-label\{font-size:16\.2px\}/);
  assert.match(mobile,/#pageMenu \.module-desc\{font-size:10\.8px\}/);
  assert.match(mobile,/#pageMenu \.module-arrow\{font-size:10\.8px\}/);
});

test('compact menu styling stays scoped to pageMenu and mobile breakpoint',()=>{
  const firstScoped=css.indexOf('#pageMenu .module-card');
  assert.ok(firstScoped>css.indexOf('@media(max-width:480px)'));
  assert.equal((css.match(/#pageMenu \.module-card/g)||[]).length,1);
});
