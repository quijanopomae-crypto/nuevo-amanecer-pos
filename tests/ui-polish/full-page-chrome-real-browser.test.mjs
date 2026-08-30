import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const absolute = path.resolve(REPO, `.${pathname}`);
      if (!(absolute === REPO || absolute.startsWith(`${REPO}${path.sep}`)) || !existsSync(absolute) || !statSync(absolute).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(absolute).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('No se pudo conectar con Chrome CDP'));
      this.ws.onmessage = ({ data }) => {
        let message;
        try { message = JSON.parse(data); } catch { return; }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function waitForPage(debugPort) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.includes('/POS/index.html'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chrome no expuso la página del POS');
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Excepción en página');
  return response.result?.value;
}

const ROOTS = {
  pageMenu: '.main-scroll',
  pageInventario: '.table-wrap',
  pageVentas: '#ventasContent',
  pageClientes: '.cli-list',
  pageCaja: '#cajContent',
  pageGastos: '#gasContent',
};
const OWNERS = {
  ...ROOTS,
  pageVentas: '.v-list-wrap',
  pageCaja: '.cj-mov-wrap',
};

function setupExpression(pageId) {
  return `(async()=>{
    document.querySelectorAll('.na-ui-geometry-filler,.na-ui-geometry-owner').forEach(el=>el.remove());
    if(${JSON.stringify(pageId)}==='pageMenu')goMenu();else goPage(${JSON.stringify(pageId)});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const page=document.getElementById(${JSON.stringify(pageId)});
    const root=page.querySelector(${JSON.stringify(ROOTS[pageId])});
    let content=page.querySelector(${JSON.stringify(OWNERS[pageId])});
    if(!content){content=document.createElement('div');content.className=${JSON.stringify(OWNERS[pageId].startsWith('.') ? OWNERS[pageId].slice(1) : '')}+' na-ui-geometry-owner';root.appendChild(content);}
    const filler=document.createElement('div');
    filler.className='na-ui-geometry-filler';
    filler.style.cssText='display:block;flex:0 0 2200px;min-height:2200px;height:2200px;width:1px;pointer-events:none';
    content.appendChild(filler);
    const mobile=innerWidth<=700;
    const scrollOwner=mobile?document.scrollingElement:content;
    if(mobile)window.scrollTo(0,0);else scrollOwner.scrollTop=0;
    (mobile?window:scrollOwner).dispatchEvent(new Event('scroll'));
    await new Promise(r=>requestAnimationFrame(r));
    return {page:page.id,mobile,owner:${JSON.stringify(OWNERS[pageId])}};
  })()`;
}

const measureExpression = `(()=>{
  const page=document.querySelector('.page.active');
  const content=page.querySelector(${JSON.stringify(Object.values(OWNERS).join(','))});
  const chrome=page.querySelector(':scope>.page-chrome');
  const topbar=document.querySelector('.g-topbar');
  const mobile=innerWidth<=700;
  const scrollTop=mobile?document.scrollingElement.scrollTop:content.scrollTop;
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
  const topRect=rect(topbar),chromeRect=rect(chrome),contentRect=rect(content);
  const visible=el=>{if(!el)return null;const r=rect(el),c=getComputedStyle(el);return c.display!=='none'&&c.visibility!=='hidden'&&r.height>0&&r.bottom>0&&r.top<innerHeight;};
  return {
    viewport:{width:innerWidth,height:innerHeight},page:page.id,mobile,scrollTop,
    topbar:{rect:topRect,visible:visible(topbar),className:topbar.className,display:getComputedStyle(topbar).display},
    chrome:chrome?{rect:chromeRect,visible:visible(chrome),display:getComputedStyle(chrome).display}:null,
    pageClass:page.className,
    content:{rect:contentRect,clientHeight:content.clientHeight,scrollHeight:content.scrollHeight,layoutTop:contentRect.top+(mobile?scrollTop:0)},
    horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth
  };
})()`;

function setScrollExpression(y) {
  return `(()=>{const page=document.querySelector('.page.active'),content=page.querySelector(${JSON.stringify(Object.values(OWNERS).join(','))}),mobile=innerWidth<=700;if(mobile){window.scrollTo(0,${y});window.dispatchEvent(new Event('scroll'));}else{content.scrollTop=${y};content.dispatchEvent(new Event('scroll'));}return mobile?document.scrollingElement.scrollTop:content.scrollTop;})()`;
}

const upwardGestureExpression = `(()=>{
  const page=document.querySelector('.page.active');
  const target=page.querySelector(${JSON.stringify(Object.values(OWNERS).join(','))});
  const fire=(type,y)=>{const event=new Event(type,{bubbles:true});Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientY:y}]});target.dispatchEvent(event);};
  fire('touchstart',300);fire('touchmove',380);fire('touchend',380);return true;
})()`;

async function exerciseScenario(client, scenario) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: scenario.width,
    height: scenario.height,
    deviceScaleFactor: 1,
    mobile: scenario.width <= 700,
  });
  await evaluate(client, setupExpression(scenario.page));
  const initial = await evaluate(client, measureExpression);

  const downTarget = initial.mobile ? Math.ceil(initial.content.layoutTop) + 220 : 220;
  await evaluate(client, setScrollExpression(downTarget));
  await sleep(420);
  const hidden = await evaluate(client, measureExpression);

  await evaluate(client, upwardGestureExpression);
  await sleep(30);
  const firstUp = await evaluate(client, measureExpression);

  await evaluate(client, upwardGestureExpression);
  await sleep(420);
  const secondUp = await evaluate(client, measureExpression);

  const rehideTarget = initial.mobile ? Math.ceil(initial.content.layoutTop) + 460 : 460;
  await evaluate(client, setScrollExpression(rehideTarget));
  await sleep(420);
  await evaluate(client, setScrollExpression(5));
  await sleep(420);
  const topReveal = await evaluate(client, measureExpression);

  const expectedRecovery = initial.topbar.rect.height + (initial.chrome?.rect.height || 0);
  const actualRecovery = initial.content.layoutTop - hidden.content.layoutTop;
  return { ...scenario, expectedRecovery, actualRecovery, initial, hidden, firstUp, secondUp, topReveal };
}

test('REAL_BROWSER_GEOMETRY — chrome completo, owners reales y 8 escenarios', { timeout: 120000 }, async () => {
  assert.ok(CHROME, `No se encontró Chrome/Edge: ${JSON.stringify(CHROME_CANDIDATES)}`);
  const { server, port } = await startStaticServer();
  const debugPort = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), 'na-ui-chrome-'));
  const url = `http://127.0.0.1:${port}/POS/index.html?na-test=1`;
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, url,
  ], { windowsHide: true, stdio: 'ignore' });
  let client;
  try {
    const target = await waitForPage(debugPort);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(client, `document.readyState==='complete'&&document.querySelectorAll('#invBody tr').length>0`)) break;
      await sleep(100);
    }

    const scenarios = [
      { name: 'Inventario 1366 desktop', page: 'pageInventario', width: 1366, height: 768 },
      { name: 'Inventario 1024 desktop', page: 'pageInventario', width: 1024, height: 768 },
      { name: 'Inventario 390 mobile', page: 'pageInventario', width: 390, height: 844 },
      { name: 'Menú', page: 'pageMenu', width: 1366, height: 768 },
      { name: 'Ventas', page: 'pageVentas', width: 1366, height: 768 },
      { name: 'Clientes', page: 'pageClientes', width: 1366, height: 768 },
      { name: 'Caja', page: 'pageCaja', width: 1366, height: 768 },
      { name: 'Gastos', page: 'pageGastos', width: 1366, height: 768 },
    ];
    const results = [];
    for (const scenario of scenarios) results.push(await exerciseScenario(client, scenario));

    for (const result of results) {
      assert.equal(result.initial.topbar.visible, true, `${result.name}: chrome global visible inicial`);
      if (result.initial.chrome) assert.equal(result.initial.chrome.visible, true, `${result.name}: chrome módulo visible inicial`);
      assert.equal(result.hidden.topbar.visible, false, `${result.name}: chrome global oculto tras bajar · ${JSON.stringify(result.hidden)}`);
      if (result.hidden.chrome) assert.equal(result.hidden.chrome.display, 'none', `${result.name}: chrome módulo fuera del layout`);
      assert.ok(result.actualRecovery >= result.expectedRecovery - 2, `${result.name}: recupera altura ${result.actualRecovery}/${result.expectedRecovery}`);
      assert.equal(result.firstUp.topbar.visible, false, `${result.name}: primer gesto arriba sigue oculto`);
      if (result.firstUp.chrome) assert.equal(result.firstUp.chrome.display, 'none', `${result.name}: primer gesto conserva módulo oculto`);
      assert.equal(result.secondUp.topbar.visible, true, `${result.name}: segundo gesto muestra global`);
      if (result.secondUp.chrome) assert.equal(result.secondUp.chrome.visible, true, `${result.name}: segundo gesto muestra módulo · ${JSON.stringify(result.secondUp)}`);
      assert.equal(result.topReveal.topbar.visible, true, `${result.name}: near-top muestra global inmediatamente`);
      if (result.topReveal.chrome) assert.equal(result.topReveal.chrome.visible, true, `${result.name}: near-top muestra módulo`);
      for (const checkpoint of ['initial', 'hidden', 'firstUp', 'secondUp', 'topReveal']) {
        assert.equal(result[checkpoint].horizontalOverflow, false, `${result.name}/${checkpoint}: sin overflow horizontal`);
      }
    }

    console.log(JSON.stringify(results.map((result) => ({
      name: result.name,
      scrollOwner: result.initial.mobile ? 'window/documentElement' : OWNERS[result.page],
      chromeVisibleInitial: result.initial.topbar.visible && (result.initial.chrome?.visible ?? true),
      chromeHiddenAfterDown: !result.hidden.topbar.visible && (result.hidden.chrome?.display === 'none' || !result.hidden.chrome),
      verticalSpaceRecovered: result.actualRecovery,
      firstUpStillHidden: !result.firstUp.topbar.visible,
      secondUpVisible: result.secondUp.topbar.visible && (result.secondUp.chrome?.visible ?? true),
      topReveal: result.topReveal.topbar.visible && (result.topReveal.chrome?.visible ?? true),
      noHorizontalOverflow: !result.topReveal.horizontalOverflow,
    })), null, 2));
  } finally {
    client?.close();
    try { child.kill(); } catch {}
    await new Promise((resolve) => server.close(resolve));
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
});
