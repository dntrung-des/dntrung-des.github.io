const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': buf.length, 'Access-Control-Allow-Origin': '*' });
        res.end(buf);
        return;
      }
      const mime = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Content-Length': stats.size, 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
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

async function run() {
  const serverBaseline = await createServer(8154, 'main.legacy.backup.css');
  const serverProd = await createServer(8155, 'main.css');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=9284`,
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
        const v = await getJson(`http://127.0.0.1:9284/json/version`);
        if (v && v.webSocketDebuggerUrl) { connected = true; break; }
      } catch (e) {}
    }
    const targets = await getJson(`http://127.0.0.1:9284/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    const selectors = [
      '.tp-skill-title',
      '.tp-skill-count',
      '.tp-section-title',
      '.tp-section-subtitle',
      '.tp-section-subtitle-bg',
      '.tp-about-fact-item p',
      '.tp-services-top-text p',
      '.tp-services-bottom-text p',
      '.tp-hero-title',
      '.tp-hero-title span',
      '.tp-hero-title span b'
    ];

    console.log("Fetching Baseline values...");
    await client.send('Page.navigate', { url: 'http://127.0.0.1:8154/index.html' });
    await sleep(1500);
    const baseline = {};
    for (const s of selectors) {
      baseline[s] = await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(s)});
        return el ? window.getComputedStyle(el).fontFamily : null;
      })()`);
    }

    console.log("Fetching Prod values...");
    await client.send('Page.navigate', { url: 'http://127.0.0.1:8155/index.html' });
    await sleep(1500);
    const prod = {};
    for (const s of selectors) {
      prod[s] = await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(s)});
        return el ? window.getComputedStyle(el).fontFamily : null;
      })()`);
    }

    console.log("\n--- DETAILED SUMMARY ---");
    for (const s of selectors) {
      const match = baseline[s] === prod[s];
      console.log(`${match ? '[OK]' : '[REGRESSION]'} ${s}: Baseline="${baseline[s]}" | Prod="${prod[s]}"`);
    }

    client.close();
  } finally {
    chromeProcess.kill();
    serverBaseline.close();
    serverProd.close();
  }
}
run().catch(console.error);
