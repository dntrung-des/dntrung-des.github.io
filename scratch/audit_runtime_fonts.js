const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8170;
const CDP_PORT = 9295;

const PAGES = [
  'index.html',
  'portfolio.html',
  'portfolio/2/app-visual-assets.html'
];

function createStaticServer(port) {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath.replace(/^\//, ''));

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf'
      };
      res.writeHead(200, {
        'Content-Type': mime[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 1; this.callbacks = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error); else resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result ? res.result.value : undefined;
  }
  close() { if (this.ws) this.ws.close(); }
}

async function auditFonts() {
  const server = await createStaticServer(PORT);
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1920,1080'
  ]);

  try {
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        const v = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (v && v.webSocketDebuggerUrl) { connected = true; break; }
      } catch (e) {}
    }
    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    const fontUsage = {}; // fontFamily -> list of { page, selector, textSnippet, count }

    for (const pageName of PAGES) {
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${pageName}` });
      await sleep(1500);

      const elementsData = await client.evaluate(`
        (() => {
          const results = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          let node;
          while (node = walker.nextNode()) {
            // Check if element has direct text or icon
            const directText = Array.from(node.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .join(' ');
            
            const isVisible = node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0;
            const cs = window.getComputedStyle(node);
            const ff = cs.fontFamily;
            
            if (directText.length > 0 || cs.content !== 'none' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'BUTTON' || node.tagName === 'I' || node.tagName === 'SVG') {
              let sel = node.tagName.toLowerCase();
              if (node.id) sel += '#' + node.id;
              if (node.className && typeof node.className === 'string') {
                sel += '.' + node.className.trim().split(/\\s+/).slice(0, 3).join('.');
              }
              results.push({
                tag: node.tagName,
                sel,
                ff,
                fs: cs.fontSize,
                fw: cs.fontWeight,
                text: directText.substring(0, 40),
                visible: isVisible
              });
            }
          }
          return results;
        })()
      `);

      for (const item of elementsData) {
        if (!fontUsage[item.ff]) {
          fontUsage[item.ff] = [];
        }
        fontUsage[item.ff].push({
          page: pageName,
          sel: item.sel,
          text: item.text,
          fs: item.fs,
          fw: item.fw,
          visible: item.visible
        });
      }
    }

    console.log(`\n======================================================`);
    console.log(`AUDIT OF COMPUTED FONT FAMILIES ACROSS ACTIVE PAGES`);
    console.log(`======================================================`);

    for (const [ff, occurrences] of Object.entries(fontUsage)) {
      console.log(`\nFONT: ${ff}`);
      console.log(`Total occurrences: ${occurrences.length}`);
      
      // Breakdown by page
      const byPage = {};
      for (const o of occurrences) {
        byPage[o.page] = (byPage[o.page] || 0) + 1;
      }
      console.log(`By page:`, JSON.stringify(byPage));

      // Sample elements
      console.log(`Sample UI elements:`);
      const sample = occurrences.filter(o => o.visible).slice(0, 5);
      sample.forEach(s => {
        console.log(`  - [${s.page}] ${s.sel} (fw:${s.fw}, fs:${s.fs}) -> "${s.text}"`);
      });
      if (sample.length === 0) {
        console.log(`  (None visible in viewport sample)`);
      }
    }

    client.close();
  } finally {
    chromeProcess.kill();
    server.close();
  }
}

auditFonts().catch(console.error);
