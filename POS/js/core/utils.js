/*
 * js/core/utils.js - utilidades TRANSVERSALES compartidas del POS (ETAPA 4, work item CORE/UTILS).
 *
 * Criterio estricto de transversalidad (demostrada por dependencia de uso
 * multi-modulo o bloque UTILS original del autor):
 *   fmt(224 usos) fmtS nowT obtenerHoy(51) HOY diasHasta(17) sinTildes(38)
 *   initials COLORS colorFor _naEsc(199) _naClean _naNumber(271) _naInt
 *   _naClone(65) _naIsPlainObject(15) _naRoundMoney(10)
 * Excluidas deliberadamente (dominio unico): familia ticket (_naTk, _naTicket),
 * familia reportes (_naF8, _naF9), importacion/productos (_naImport, alt-codes,
 * category), impresion-UI (_naEsAndroid, _naEsMovil), seguridad (_naSecHash),
 * _naNewUuid (reside dentro del script V10 dormante) y un-consumidor
 * (_naTime24, _naParseTime24, _naUnitsPerQty, _naUnitsSold, _naLineKey,
 * _naDatePlus, _naCashierIdNumber, _naCsvCell).
 *
 * Extraidas byte-exacto desde POS/index.html @ 45c8c1e (FASE 7 frozen).
 * Codigo MOVIDO, no reescrito. Classic script SIN defer/async; carga antes
 * de todos los scripts inline. Sin negocio, sin storage, sin DOM, sin V10.
 */


// ===== UTILS =====
const fmt=n=>`S/ ${parseFloat(n||0).toFixed(2)}`;
const fmtS=n=>`S/${parseFloat(n||0).toFixed(0)}`;
const nowT=()=>new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function obtenerHoy(){const ahora=new Date();const local=new Date(ahora.getTime()-(ahora.getTimezoneOffset()*60000));return local.toISOString().split('T')[0];}
const HOY=obtenerHoy;
const diasHasta=s=>{if(!s)return null;const d=new Date(String(s).slice(0,10)+'T00:00:00');if(Number.isNaN(d.getTime()))return null;const hoyD=new Date(obtenerHoy()+'T00:00:00');return Math.round((d-hoyD)/86400000);};
const sinTildes=str=>str.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const initials=n=>n.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
const COLORS=['#00bca4','#ff7043','#a855f7','#3b82f6','#f59e0b','#ef4444','#22c55e','#64748b'];
const colorFor=i=>COLORS[i%8];
const _naEsc=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const _naClean=value=>String(value??'').replace(/[<>]/g,'').trim();
const _naNumber=(value,fallback=0)=>{if(typeof value==='number')return Number.isFinite(value)?value:fallback;let str=String(value??'').trim().replace(/\s/g,'');if(!str)return fallback;if(str.includes(',')&&str.includes('.')){if(str.lastIndexOf(',')>str.lastIndexOf('.'))str=str.replace(/\./g,'').replace(',','.');else str=str.replace(/,/g,'');}else if(str.includes(','))str=str.replace(',','.');str=str.replace(/[^0-9.-]/g,'');const n=Number(str);return Number.isFinite(n)?n:fallback;};
const _naInt=(value,fallback=0)=>{const n=Math.trunc(_naNumber(value,NaN));return Number.isFinite(n)?n:fallback;};
const _naClone=value=>{try{return structuredClone(value);}catch(error){return JSON.parse(JSON.stringify(value));}};
function _naIsPlainObject(value){if(!value||Object.prototype.toString.call(value)!=='[object Object]')return false;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}
function _naRoundMoney(value){return Number(Math.max(0,_naNumber(value)).toFixed(2));}
