// DOM mínimo para pruebas del asistente (sin dependencias): elementos, texto, fragmentos, clases y eventos.
export class Node_ {
  constructor(doc, type, tag) { this.ownerDocument = doc; this.nodeType = type; this.tagName = tag ? tag.toUpperCase() : undefined; this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = {}; this.dataset = {}; this.listeners = {}; this._cls = new Set(); this.nodeValue = null; this.hidden = false; this.disabled = false; this.value = ''; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; } }; }
  appendChild(n) { if (n.nodeType === 11) { [...n.childNodes].forEach((c) => this.appendChild(c)); return n; } if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  replaceChild(n, old) { const i = this.childNodes.indexOf(old); const add = n.nodeType === 11 ? [...n.childNodes] : [n]; add.forEach((c) => { c.parentNode = this; }); if (n.nodeType === 11) n.childNodes = []; this.childNodes.splice(i, 1, ...add); old.parentNode = null; return old; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatch(t, e = {}) { (this.listeners[t] || []).forEach((f) => f.call(this, { target: this, preventDefault() {}, ...e })); if (t === 'click' && this.onclick) this.onclick.call(this, { target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { if (this.nodeType === 3) { this.nodeValue = String(v); return; } this.childNodes = []; if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  all() { const out = []; const rec = (n) => n.childNodes.forEach((c) => { out.push(c); rec(c); }); rec(this); return out; }
  byClass(c) { return this.all().filter((n) => n.nodeType === 1 && n._cls.has(c)); }
  byTag(t) { return this.all().filter((n) => n.tagName === t.toUpperCase()); }
}
export function makeDoc() {
  const doc = {
    createElement: (t) => { const n = new Node_(doc, 1, t); if (t === 'canvas') { n.width = 0; n.height = 0; n.ops = []; n.getContext = () => ({ fillRect() {}, setTransform: (...a) => n.ops.push(['t', ...a]), drawImage: (...a) => n.ops.push(['d', ...a]), set fillStyle(v) {} }); n.toDataURL = () => 'data:image/jpeg;base64,QUJD'; } return n; },
    createTextNode: (v) => { const n = new Node_(doc, 3); n.nodeValue = String(v); return n; },
    createDocumentFragment: () => new Node_(doc, 11),
  };
  doc.body = doc.createElement('body');
  return doc;
}
