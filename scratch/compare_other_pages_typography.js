const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT_BASELINE = 8152;
const PORT_PROD = 8153;
const CDP_PORT = 9282;

function createServer(port, cssFile) {
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

      if (ext === '.html') {
        let content = fs.readFileSync(filePath, 'utf-8');
        content = content.replace(/href=["'][^"']*main\.css["']/gi, `href="/assets/css/${cssFile}"`);
        const buf = Buffer.from(content, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': buf.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(buf);
        return;
      }

      const mime = {
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf'
      };

      res.writeHead(200, {
        'Content-Type': mime[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
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

const PAGES_TO_CHECK = [
  {
    page: 'portfolio.html',
    selectors: [
      '.tp-portfolio-title',
      '.tp-portfolio-meta-count',
      '.blog-list__tab-btn button',
      '.tp-footer-3__area h3',
      '.tp-section-title'
    ]
  },
  {
    page: 'portfolio/2/app-visual-assets.html',
    selectors: [
      '.porfolio-details__left-info-title',
      '.porfolio-details__right-title',
      '.tp-section-title-4',
      '.tp-portfolio-item-3 .title',
      '.portfolio-details-navigation .nav-title',
      '.tp-section-title',
      '.tp-section-subtitle'
    ]
  }
];

async function run() {
  const serverBaseline = await createServer(PORT_BASELINE, 'main.legacy.backup.css');
  const serverProd = await createServer(PORT_PROD, 'main.css');

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

    for (const p of PAGES_TO_CHECK) {
      console.log(`\n======================================================`);
      console.log(`CHECKING PAGE: ${p.page}`);
      console.log(`======================================================`);

      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT_BASELINE}/${p.page}` });
      await sleep(1500);
      const baselineVals = {};
      for (const sel of p.selectors) {
        baselineVals[sel] = await client.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(sel)});
            return el ? window.getComputedStyle(el).fontFamily : null;
          })()
        `);
      }

      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT_PROD}/${p.page}` });
      await sleep(1500);
      const prodVals = {};
      for (const sel of p.selectors) {
        prodVals[sel] = await client.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(sel)});
            return el ? window.getComputedStyle(el).fontFamily : null;
          })()
        `);
      }

      for (const sel of p.selectors) {
        const b = baselineVals[sel];
        const pr = prodVals[sel];
        if (b === pr) {
          console.log(`  [OK] ${sel}: "${b}"`);
        } else {
          console.log(`  [DIFF] ${sel}: BASELINE="${b}" vs PROD="${pr}"`);
        }
      }
    }

    client.close();
  } finally {
    chromeProcess.kill();
    serverBaseline.close();
    serverProd.close();
  }
}

run().catch(console.error);
