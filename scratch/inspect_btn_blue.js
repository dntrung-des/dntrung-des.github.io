const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8610;
const CDP_PORT = 9700;

function createStaticServer(port) {
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath.replace(/^\//, ''));
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            try { res(JSON.parse(d)); } catch(e) { rej(e); }
          });
        }).on('error', rej);
      });
      const pageTarget = targets.find(t => t.type === 'page') || targets[0];
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Could not find page target');
}

async function run() {
  const server = await createStaticServer(PORT);
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=/tmp/chrome-btn-test-${CDP_PORT}`
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

  const initialData = (await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.tp-btn-blue');
      const btnStyle = window.getComputedStyle(btn);
      const afterStyle = window.getComputedStyle(btn, '::after');
      const icon = btn.querySelector('.icon');
      const text = btn.querySelector('.text');
      const textAfterStyle = window.getComputedStyle(text, '::after');
      
      const r = btn.getBoundingClientRect();
      const ir = icon.getBoundingClientRect();

      return {
        btnBox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        iconBox: { x: Math.round(ir.x), y: Math.round(ir.y), width: Math.round(ir.width), height: Math.round(ir.height) },
        afterStyle: {
          width: afterStyle.width,
          height: afterStyle.height,
          borderRadius: afterStyle.borderRadius,
          backgroundColor: afterStyle.backgroundColor,
          transition: afterStyle.transition,
          transform: afterStyle.transform,
          right: afterStyle.right,
          top: afterStyle.top
        }
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('INITIAL DATA:', JSON.stringify(initialData, null, 2));

  // Capture normal screenshot of hero button
  const box = (await send('Runtime.evaluate', {
    expression: `(() => {
      const r = document.querySelector('.tp-btn-blue').getBoundingClientRect();
      return { x: Math.round(r.x - 20), y: Math.round(r.y - 20), width: Math.round(r.width + 250), height: Math.round(r.height + 40), scale: 1 };
    })()`,
    returnByValue: true
  })).result.value;

  const res1 = await send('Page.captureScreenshot', { format: 'png', clip: box });
  fs.writeFileSync('scratch/btn_blue_normal_fixed.png', Buffer.from(res1.data, 'base64'));

  // Hover over the button
  const mousePos = (await send('Runtime.evaluate', {
    expression: `(() => {
      const r = document.querySelector('.tp-btn-blue').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
    returnByValue: true
  })).result.value;

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mousePos.x, y: mousePos.y });
  await new Promise(r => setTimeout(r, 600));

  const hoverData = (await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.tp-btn-blue');
      const afterStyle = window.getComputedStyle(btn, '::after');
      const icon = btn.querySelector('.icon');
      const ir = icon.getBoundingClientRect();
      const br = btn.getBoundingClientRect();

      return {
        afterStyle: {
          width: afterStyle.width,
          height: afterStyle.height,
          borderRadius: afterStyle.borderRadius,
          backgroundColor: afterStyle.backgroundColor,
          transition: afterStyle.transition,
          transform: afterStyle.transform,
          right: afterStyle.right
        },
        distanceFromRightEdge: Math.round(br.right - ir.right),
        iconCenterFromRightEdge: Math.round(br.right - (ir.x + ir.width/2))
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('HOVER DATA:', JSON.stringify(hoverData, null, 2));

  const res2 = await send('Page.captureScreenshot', { format: 'png', clip: box });
  fs.writeFileSync('scratch/btn_blue_hover_fixed.png', Buffer.from(res2.data, 'base64'));

  ws.close();
  proc.kill();
  server.close();
}

run().catch(console.error);
