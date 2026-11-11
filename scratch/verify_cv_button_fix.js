const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 8620;
const CDP_PORT = 9710;

function createStaticServer(port) {
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = require('path').join(process.cwd(), reqPath.replace(/^\//, ''));
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[require('path').extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(res => server.listen(port, () => res(server)));
}

async function getWsUrl(cdpPort) {
  for (let i = 0; i < 25; i++) {
    try {
      const targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${cdpPort}/json`, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => {
            try { res(JSON.parse(d)); } catch(e) { rej(e); }
          });
        }).on('error', rej);
      });
      const pageTarget = targets.find(t => t.type === 'page') || targets[0];
      if (pageTarget && pageTarget.webSocketDebuggerUrl) return pageTarget.webSocketDebuggerUrl;
    } catch(e){}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('No target');
}

async function run() {
  const server = await createStaticServer(PORT);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=/tmp/chrome-cv-verify-${CDP_PORT}`
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const wsUrl = await getWsUrl(CDP_PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const curId = id++;
    const handler = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id === curId) {
        ws.removeEventListener('message', handler);
        if (msg.error) rej(msg.error);
        else res(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 1200));

  const normalMeasure = (await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.header-cv-cta');
      const after = window.getComputedStyle(btn, '::after');
      const text = btn.querySelector('.text');
      const svg = btn.querySelector('svg');
      const br = btn.getBoundingClientRect();
      const tr = text.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      return {
        btn: { w: Math.round(br.width), h: Math.round(br.height) },
        after: { w: after.width, h: after.height, r: after.borderRadius },
        svgCenterFromRight: Math.round(br.right - (sr.x + sr.width/2)),
        circleCenterFromRight: 21
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('NORMAL MEASURE:', JSON.stringify(normalMeasure, null, 2));

  // Hover
  const mousePos = (await send('Runtime.evaluate', {
    expression: `(() => {
      const r = document.querySelector('.header-cv-cta').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
    returnByValue: true
  })).result.value;

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mousePos.x, y: mousePos.y });
  await new Promise(r => setTimeout(r, 600));

  const hoverMeasure = (await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.header-cv-cta');
      const after = window.getComputedStyle(btn, '::after');
      const text = btn.querySelector('.text');
      const svg = btn.querySelector('svg');
      const br = btn.getBoundingClientRect();
      const tr = text.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      return {
        btn: { w: Math.round(br.width), h: Math.round(br.height) },
        after: { w: after.width, h: after.height, r: after.borderRadius },
        gapBetweenTextAndCircle: Math.round((br.right - 42) - tr.right),
        svgCenterFromRight: Math.round(br.right - (sr.x + sr.width/2)),
        circleCenterFromRight: 21
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('HOVER MEASURE:', JSON.stringify(hoverMeasure, null, 2));

  const clip = (await send('Runtime.evaluate', {
    expression: `(() => {
      const r = document.querySelector('.header-cv-cta').getBoundingClientRect();
      return { x: Math.round(r.x - 30), y: Math.round(r.y - 15), width: Math.round(r.width + 60), height: Math.round(r.height + 30), scale: 2 };
    })()`,
    returnByValue: true
  })).result.value;

  const resHover = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync('scratch/verified_cv_btn_hover.png', Buffer.from(resHover.data, 'base64'));

  ws.close();
  proc.kill();
  server.close();
}
run().catch(console.error);
