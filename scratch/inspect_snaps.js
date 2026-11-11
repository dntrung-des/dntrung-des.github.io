const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8197;
const CDP_PORT = 9270;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
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
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function run() {
  const server = await createStaticServer(PORT);
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=/tmp/chrome_profile_9270',
    '--window-size=1920,1080'
  ]);

  await new Promise(r => setTimeout(r, 1200));

  let targets = [];
  for (let i = 0; i < 20; i++) {
    try {
      targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${CDP_PORT}/json`, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      if (targets.length) break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });

  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const { resolve, reject } = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    callbacks.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 2000));

  async function takeWordSnap(name, wordText, customCss) {
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          let el = document.getElementById('test-custom-css');
          if (!el) {
            el = document.createElement('style');
            el.id = 'test-custom-css';
            document.head.appendChild(el);
          }
          el.textContent = \`${customCss}\`;

          const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));
          const wrapper = document.querySelector('.cd-words-wrapper');
          const target = words.find(w => w.textContent.includes('${wordText}'));

          words.forEach(w => { w.classList.remove('is-visible'); w.classList.add('is-hidden'); });
          target.classList.remove('is-hidden');
          target.classList.add('is-visible');
          wrapper.style.width = (target.offsetWidth + 10) + 'px';
        })()
      `
    });
    await new Promise(r => setTimeout(r, 100));

    const snap = await send('Page.captureScreenshot', {
      clip: { x: 300, y: 220, width: 1300, height: 200, scale: 1 }
    });
    fs.writeFileSync(`scratch/${name}.png`, Buffer.from(snap.data, 'base64'));
  }

  const css = `
    .tp-hero-title .cd-words-wrapper b {
      font-size: 0.85em;
    }
    .cd-words-wrapper .app {
      transform: none;
    }
  `;

  await takeWordSnap('snap_uxui', 'UX/UI', css);
  await takeWordSnap('snap_product', 'PRODUCT', css);
  await takeWordSnap('snap_visual', 'VISUAL', css);

  console.log('Screenshots captured successfully!');

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
