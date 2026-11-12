const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8196;
const CDP_PORT = 9269;

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
    '--user-data-dir=/tmp/chrome_profile_9269',
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

  const check = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const style = document.createElement('style');
        style.textContent = \`
          .tp-hero-title .cd-words-wrapper b {
            font-size: 0.82em !important;
          }
          .cd-words-wrapper .app {
            transform: none !important;
          }
        \`;
        document.head.appendChild(style);

        const h1 = document.querySelector('.tp-hero-title');
        const wrapper = document.querySelector('.cd-words-wrapper');
        const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));

        const wordsData = words.map(w => {
          words.forEach(x => { x.classList.remove('is-visible'); x.classList.add('is-hidden'); });
          w.classList.remove('is-hidden');
          w.classList.add('is-visible');
          wrapper.style.width = (w.offsetWidth + 10) + 'px';

          const r = w.getBoundingClientRect();
          const wr = wrapper.getBoundingClientRect();
          const hr = h1.getBoundingClientRect();

          return {
            text: w.textContent.trim(),
            bottom: r.bottom,
            top: r.top,
            h1Bottom: hr.bottom,
            diffBottom: hr.bottom - r.bottom
          };
        });

        return wordsData;
      })()
    `,
    returnByValue: true
  });

  console.log('Vertical alignment data:', JSON.stringify(check.result.value, null, 2));

  // Screenshot with 0.82em
  const snap = await send('Page.captureScreenshot', {
    clip: { x: 0, y: 150, width: 1400, height: 350, scale: 1 }
  });
  fs.writeFileSync('scratch/headline_aligned.png', Buffer.from(snap.data, 'base64'));

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
