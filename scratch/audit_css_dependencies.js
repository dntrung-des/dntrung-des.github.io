const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8130;
const CDP_PORT = 9265;

const PAGES = [
  'index.html',
  'portfolio.html',
  'portfolio/2/app-visual-assets.html'
];

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

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
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
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

async function auditRuntime() {
  console.log('Starting static server on port ' + PORT + '...');
  const server = await createStaticServer(PORT);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1920,1080'
  ]);

  try {
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        const version = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) {
          connected = true;
          break;
        }
      } catch (e) {}
    }
    if (!connected) throw new Error('Could not connect to Chrome CDP');

    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('\n======================================================');
    console.log('AUDITING ACTIVE PAGES RUNTIME CSS DEPENDENCIES');
    console.log('======================================================');

    // 1. Audit Spacing Impact on Homepage
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await sleep(2000);

    const spacingImpact = await client.evaluate(`
      (() => {
        const footer = document.querySelector('.tp-footer-3__area');
        const before = {
          pt: window.getComputedStyle(footer).paddingTop,
          pb: window.getComputedStyle(footer).paddingBottom
        };
        const link = document.querySelector('link[href*="spacing.css"]');
        if (link) link.disabled = true;
        const after = {
          pt: window.getComputedStyle(footer).paddingTop,
          pb: window.getComputedStyle(footer).paddingBottom
        };
        if (link) link.disabled = false;
        return { before, after };
      })()
    `);

    console.log('\n--- 1. spacing.css Runtime Impact ---');
    console.log('.tp-footer-3__area padding WITH spacing.css   :', spacingImpact.before);
    console.log('.tp-footer-3__area padding WITHOUT spacing.css:', spacingImpact.after);

    // 2. Audit Bootstrap Impact on Grid
    const bootstrapImpact = await client.evaluate(`
      (() => {
        const row = document.querySelector('.row');
        const col = document.querySelector('.col-xl-12, [class*="col-"]');
        const before = {
          rowDisplay: window.getComputedStyle(row).display,
          colWidth: col ? Math.round(parseFloat(window.getComputedStyle(col).width)) : null
        };
        const link = document.querySelector('link[href*="bootstrap.css"]');
        if (link) link.disabled = true;
        const after = {
          rowDisplay: window.getComputedStyle(row).display,
          colWidth: col ? Math.round(parseFloat(window.getComputedStyle(col).width)) : null
        };
        if (link) link.disabled = false;
        return { before, after };
      })()
    `);

    console.log('\n--- 2. bootstrap.css Runtime Impact ---');
    console.log('.row / .col WITH bootstrap.css   :', bootstrapImpact.before);
    console.log('.row / .col WITHOUT bootstrap.css:', bootstrapImpact.after);

    // 3. Audit Font Awesome Pro Impact
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/portfolio/2/app-visual-assets.html` });
    await sleep(2000);

    const faImpact = await client.evaluate(`
      (() => {
        const icon = document.querySelector('.fa-regular');
        const before = {
          fontFamily: icon ? window.getComputedStyle(icon).fontFamily : null,
          content: icon ? window.getComputedStyle(icon, '::before').content : null
        };
        const link = document.querySelector('link[href*="font-awesome-pro.css"]');
        if (link) link.disabled = true;
        const after = {
          fontFamily: icon ? window.getComputedStyle(icon).fontFamily : null,
          content: icon ? window.getComputedStyle(icon, '::before').content : null
        };
        if (link) link.disabled = false;
        return { before, after };
      })()
    `);

    console.log('\n--- 3. font-awesome-pro.css Runtime Impact ---');
    console.log('.fa-regular icon WITH font-awesome-pro.css   :', faImpact.before);
    console.log('.fa-regular icon WITHOUT font-awesome-pro.css:', faImpact.after);

    client.close();
  } catch (err) {
    console.error('Audit exception:', err);
  } finally {
    chromeProcess.kill();
    server.close();
  }
}

auditRuntime();
