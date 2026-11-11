const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8198;
const CDP_PORT = 9271;

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
    '--user-data-dir=/tmp/chrome_profile_9271',
    '--window-size=390,844'
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
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 2000));

  const mobileSizes = [50, 46, 44, 42];
  for (const fsSize of mobileSizes) {
    const res = await send('Runtime.evaluate', {
      expression: `
        (() => {
          let el = document.getElementById('test-mobile-fs');
          if (!el) {
            el = document.createElement('style');
            el.id = 'test-mobile-fs';
            document.head.appendChild(el);
          }
          el.textContent = \`
            @media (max-width: 767px) {
              .tp-hero-title {
                font-size: ${fsSize}px !important;
              }
            }
          \`;

          const h1 = document.querySelector('.tp-hero-title');
          const wrapper = document.querySelector('.cd-words-wrapper');
          const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));
          const target = words.find(w => w.textContent.includes('PRODUCT'));

          words.forEach(w => { w.classList.remove('is-visible'); w.classList.add('is-hidden'); });
          target.classList.remove('is-hidden');
          target.classList.add('is-visible');
          wrapper.style.width = (target.offsetWidth + 10) + 'px';

          const splitDiv = h1.querySelector('div');
          const h1Rect = h1.getBoundingClientRect();
          const splitRect = splitDiv ? splitDiv.getBoundingClientRect() : null;

          return {
            fsSize: ${fsSize},
            productWidth: target.offsetWidth,
            wrapperWidth: wrapper.offsetWidth,
            h1Height: h1Rect.height,
            splitDivHeight: splitRect ? splitRect.height : null,
            wrapped: (splitRect ? splitRect.height : h1Rect.height) > (fsSize * 1.5)
          };
        })()
      `,
      returnByValue: true
    });
    console.log(`Mobile ${fsSize}px:`, res.result.value);
  }

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
