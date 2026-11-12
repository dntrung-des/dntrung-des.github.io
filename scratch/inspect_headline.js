const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8194;
const CDP_PORT = 9267;

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
    '--user-data-dir=/tmp/chrome_profile_9267',
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

  async function checkLayout(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    // Wait for initial GSAP SplitText and animated headline to initialize
    await new Promise(r => setTimeout(r, 2500));

    // Check each word state: UX/UI, PRODUCT, VISUAL
    const res = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const h1 = document.querySelector('.tp-hero-title');
          const wrapper = document.querySelector('.cd-words-wrapper');
          const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));
          const container = document.querySelector('.tp-hero-3__content');

          // Simulate making PRODUCT visible and measuring
          const productWord = words.find(w => w.textContent.includes('PRODUCT'));
          const uxWord = words.find(w => w.textContent.includes('UX/UI'));
          const visualWord = words.find(w => w.textContent.includes('VISUAL'));

          function measureState(wordEl) {
            words.forEach(w => {
              w.classList.remove('is-visible');
              w.classList.add('is-hidden');
            });
            wordEl.classList.remove('is-hidden');
            wordEl.classList.add('is-visible');
            wrapper.style.width = (wordEl.offsetWidth + 10) + 'px';

            const h1Rect = h1.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();
            
            // Check if there is wrapping inside h1
            // Look for text node "Designer" or the div created by SplitText
            const splitDiv = h1.querySelector('div');
            const splitRect = splitDiv ? splitDiv.getBoundingClientRect() : null;

            return {
              word: wordEl.textContent.trim(),
              wordWidth: wordEl.offsetWidth,
              wrapperWidth: wrapper.offsetWidth,
              h1Height: h1Rect.height,
              h1Width: h1Rect.width,
              splitDivHeight: splitRect ? splitRect.height : null,
              wrapped: splitRect ? splitRect.height > 150 : h1Rect.height > 150
            };
          }

          return {
            viewport: window.innerWidth,
            containerWidth: container.offsetWidth,
            h1FontSize: window.getComputedStyle(h1).fontSize,
            uxui: measureState(uxWord),
            product: measureState(productWord),
            visual: measureState(visualWord)
          };
        })()
      `,
      returnByValue: true
    });

    console.log(`\n=== Viewport ${width} ===`);
    console.log(JSON.stringify(res.result.value, null, 2));

    // Capture screenshot with PRODUCT visible
    const snap = await send('Page.captureScreenshot', {
      clip: { x: 0, y: 0, width: width, height: Math.min(height, 800), scale: 1 }
    });
    fs.writeFileSync(`scratch/headline_product_${width}.png`, Buffer.from(snap.data, 'base64'));
  }

  await checkLayout(1920, 1080);
  await checkLayout(1440, 900);
  await checkLayout(1366, 768);
  await checkLayout(1200, 800);
  await checkLayout(992, 700);
  await checkLayout(768, 1024);
  await checkLayout(390, 844);

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
