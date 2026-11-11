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

async function verifyScreenshots() {
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

  async function snap(name, width, height, theme) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    if (theme === 'light') {
      await send('Runtime.evaluate', {
        expression: `document.documentElement.setAttribute('tp-theme', 'tp-theme-light');`
      });
      await new Promise(r => setTimeout(r, 300));
    }

    const geo = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const container = document.querySelector('.tp-service-3__circle-img');
          const textImg = document.querySelector('.tp-service-3__circle-img .text-img');
          const shape = document.querySelector('.tp-service-3__circle-img .shape');
          const cRect = container.getBoundingClientRect();
          const tRect = textImg.getBoundingClientRect();
          const sRect = shape.getBoundingClientRect();
          return {
            container: { left: cRect.left, width: cRect.width },
            textImg: { cx: tRect.left + tRect.width / 2, cy: tRect.top + tRect.height / 2 },
            shape: { cx: sRect.left + sRect.width / 2, cy: sRect.top + sRect.height / 2 },
            diffX: (tRect.left + tRect.width / 2) - (sRect.left + sRect.width / 2)
          };
        })()
      `,
      returnByValue: true
    });

    console.log(`${name} [${theme}] Alignment: diffX = ${geo.result.value.diffX}`);

    const clip = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('.tp-service-3__circle-img');
          const rect = el.getBoundingClientRect();
          return {
            x: Math.max(0, rect.left - 30),
            y: Math.max(0, rect.top - 80),
            width: rect.width + 60,
            height: rect.height + 160,
            scale: 1
          };
        })()
      `,
      returnByValue: true
    });

    const screenshot = await send('Page.captureScreenshot', {
      clip: clip.result.value
    });
    const filename = `scratch/final_${name}_${theme}.png`;
    fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
    console.log(`Saved screenshot: ${filename}`);
  }

  await snap('desktop', 1920, 1080, 'dark');
  await snap('desktop', 1920, 1080, 'light');
  await snap('mobile', 390, 844, 'dark');
  await snap('mobile', 390, 844, 'light');

  ws.close();
  chromeProcess.kill();
  server.close();
  process.exit(0);
}

verifyScreenshots().catch(console.error);
