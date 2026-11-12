const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT_BASELINE = 8150;
const PORT_PROD = 8151;
const CDP_PORT = 9280;

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
        // Replace main.css with the target cssFile
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
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
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }
  close() {
    if (this.ws) this.ws.close();
  }
}

const TARGET_SELECTORS = [
  { desc: "Homepage Hero: .tp-hero-title", sel: ".tp-hero-title" },
  { desc: "Homepage Hero: .tp-hero-title span", sel: ".tp-hero-title span" },
  { desc: "Homepage Hero: .tp-hero-title span b.is-visible", sel: ".tp-hero-title span b.is-visible" },
  { desc: "Homepage Hero: .tp-hero-title span b.app (GRAPHIC)", sel: ".tp-hero-title span b.app" },
  { desc: "Homepage Hero: .tp-hero-content > span", sel: ".tp-hero-content > span" },
  { desc: "Services Background Text: .tp-services-top-text p", sel: ".tp-services-top-text p" },
  { desc: "Services Section Title: .tp-section-title-3", sel: ".tp-section-title-3" },
  { desc: "About Subtitle Bg: .tp-section-subtitle-bg", sel: ".tp-section-subtitle-bg" },
  { desc: "About Subtitle: .tp-section-subtitle", sel: ".tp-section-subtitle" },
  { desc: "About Fact Item p: .tp-about-fact-item p", sel: ".tp-about-fact-item p" },
  { desc: "Accordion Button span: .tp-services-accordion .accordion-button span", sel: ".tp-services-accordion .accordion-button span" },
  { desc: "Section Title: .tp-section-title", sel: ".tp-section-title" }
];

async function measurePage(client, url) {
  await client.send('Page.navigate', { url });
  await sleep(1500);

  const results = {};
  for (const t of TARGET_SELECTORS) {
    const data = await client.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(t.sel)});
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        return {
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontStyle: cs.fontStyle,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
          fontFeatureSettings: cs.fontFeatureSettings,
          fontVariationSettings: cs.fontVariationSettings
        };
      })()
    `);
    results[t.desc] = data;
  }
  return results;
}

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
        if (v && v.webSocketDebuggerUrl) {
          connected = true;
          break;
        }
      } catch (e) {}
    }
    if (!connected) throw new Error('Chrome CDP connection failed');

    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('CSS.enable');

    console.log(`\n=== MEASURING BASELINE (main.legacy.backup.css) ===`);
    const baselineResults = await measurePage(client, `http://127.0.0.1:${PORT_BASELINE}/index.html`);

    console.log(`\n=== MEASURING PRODUCTION (main.css) ===`);
    const prodResults = await measurePage(client, `http://127.0.0.1:${PORT_PROD}/index.html`);

    console.log(`\n========================================================================================`);
    console.log(`TYPOGRAPHY COMPARISON: BASELINE vs PRODUCTION`);
    console.log(`========================================================================================`);

    for (const t of TARGET_SELECTORS) {
      const b = baselineResults[t.desc];
      const p = prodResults[t.desc];
      console.log(`\n[${t.desc}] (selector: ${t.sel})`);
      if (!b && !p) {
        console.log(`  Element NOT found in either version.`);
        continue;
      }
      if (!b || !p) {
        console.log(`  Mismatch in presence! Baseline: ${!!b}, Prod: ${!!p}`);
        continue;
      }

      const diffs = [];
      for (const k of Object.keys(b)) {
        if (b[k] !== p[k]) {
          diffs.push(`    - ${k}: BASELINE="${b[k]}" vs PROD="${p[k]}"`);
        }
      }

      if (diffs.length === 0) {
        console.log(`  MATCH: fontFamily="${b.fontFamily}", fontSize="${b.fontSize}", fontWeight="${b.fontWeight}"`);
      } else {
        console.log(`  REGRESSION DETECTED!`);
        diffs.forEach(d => console.log(d));
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
