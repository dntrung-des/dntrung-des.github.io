const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8199;
const CDP_PORT = 9245;

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

async function testAlign(yOffset) {
  const server = await createStaticServer(PORT);
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1920,1080'
  ]);

  await new Promise(r => setTimeout(r, 1000));

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
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 2000));

  // Apply test styles
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const style = document.createElement('style');
        style.id = 'test-circle-style';
        style.innerHTML = \`
          .tp-service-3__circle-img {
            position: absolute;
            top: 0;
            right: 315px;
            width: 260px;
            height: 70px;
            z-index: 5;
          }
          @media (max-width: 767px) {
            .tp-service-3__circle-img {
              right: 30px;
            }
          }
          .tp-service-3__circle-img .shape {
            position: absolute;
            top: -1px;
            left: 0;
            width: 260px;
            height: 70px;
            z-index: -1;
            pointer-events: none;
          }
          .tp-service-3__circle-img .shape svg {
            width: 260px;
            height: 70px;
            display: block;
            color: #0F183E;
          }
          .tp-service-3__circle-img .text-img {
            position: absolute;
            left: 50%;
            top: 0;
            transform: translate(-50%, ${yOffset});
            display: inline-block;
            width: 120px;
            height: 118px;
            text-align: center;
          }
          .tp-service-3__circle-img .text-img img {
            width: 120px;
            height: 118px;
            display: block;
            margin: 0 auto;
            animation: none !important;
          }
        \`;
        document.head.appendChild(style);
      })()
    `
  });

  await new Promise(r => setTimeout(r, 300));

  const geo = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const container = document.querySelector('.tp-service-3__circle-img').getBoundingClientRect();
        const textImg = document.querySelector('.tp-service-3__circle-img .text-img').getBoundingClientRect();
        const shape = document.querySelector('.tp-service-3__circle-img .shape').getBoundingClientRect();
        const svg = document.querySelector('.tp-service-3__circle-img .shape svg').getBoundingClientRect();
        return {
          containerCx: container.left + container.width / 2,
          textImgCx: textImg.left + textImg.width / 2,
          textImgCy: textImg.top + textImg.height / 2,
          shapeCx: shape.left + shape.width / 2,
          svgCx: svg.left + svg.width / 2,
          shapeTop: shape.top,
          textImgBottom: textImg.bottom,
          diffX: (textImg.left + textImg.width / 2) - (shape.left + shape.width / 2)
        };
      })()
    `,
    returnByValue: true
  });

  console.log('Geometry for ' + yOffset + ':', geo.result.value);

  // Take screenshot
  const clip = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector('.tp-service-3__circle-img');
        const rect = el.getBoundingClientRect();
        return {
          x: Math.max(0, rect.left - 50),
          y: Math.max(0, rect.top - 100),
          width: 360,
          height: 250,
          scale: 1
        };
      })()
    `,
    returnByValue: true
  });

  const screenshot = await send('Page.captureScreenshot', {
    clip: clip.result.value
  });
  const fname = 'scratch/circle_test_' + yOffset.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
  fs.writeFileSync(fname, Buffer.from(screenshot.data, 'base64'));
  console.log('Saved ' + fname);

  ws.close();
  chromeProcess.kill();
  server.close();
}

async function run() {
  await testAlign('-50%');
  await testAlign('-60px');
  await testAlign('-50px');
  process.exit(0);
}

run().catch(console.error);
