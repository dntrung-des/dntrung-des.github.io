const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8195;
const CDP_PORT = 9268;

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
    '--user-data-dir=/tmp/chrome_profile_9268',
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

  const scales = ['0.88em', '0.85em', '0.82em', '0.80em'];

  for (const scale of scales) {
    console.log(`\n================ Testing Scale: ${scale} ================`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 2000));

    const testRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          // Apply scale to .cd-words-wrapper b
          const style = document.createElement('style');
          style.textContent = \`
            .tp-hero-title .cd-words-wrapper b {
              font-size: ${scale} !important;
            }
          \`;
          document.head.appendChild(style);

          const h1 = document.querySelector('.tp-hero-title');
          const wrapper = document.querySelector('.cd-words-wrapper');
          const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));
          const container = document.querySelector('.tp-hero-3__content');

          const productWord = words.find(w => w.textContent.includes('PRODUCT'));
          const uxWord = words.find(w => w.textContent.includes('UX/UI'));
          const visualWord = words.find(w => w.textContent.includes('VISUAL'));

          function checkWord(wordEl) {
            words.forEach(w => {
              w.classList.remove('is-visible');
              w.classList.add('is-hidden');
            });
            wordEl.classList.remove('is-hidden');
            wordEl.classList.add('is-visible');
            wrapper.style.width = (wordEl.offsetWidth + 10) + 'px';

            const splitDiv = h1.querySelector('div');
            const h1Rect = h1.getBoundingClientRect();
            const splitRect = splitDiv ? splitDiv.getBoundingClientRect() : null;

            return {
              word: wordEl.textContent.trim(),
              wordWidth: wordEl.offsetWidth,
              wrapperWidth: wrapper.offsetWidth,
              h1Height: h1Rect.height,
              wrapped: (splitRect ? splitRect.height : h1Rect.height) > 150
            };
          }

          return {
            containerWidth: container.offsetWidth,
            uxui: checkWord(uxWord),
            product: checkWord(productWord),
            visual: checkWord(visualWord)
          };
        })()
      `,
      returnByValue: true
    });

    console.log(JSON.stringify(testRes.result.value, null, 2));

    // Capture screenshot
    const snap = await send('Page.captureScreenshot', {
      clip: { x: 0, y: 0, width: 1920, height: 600, scale: 1 }
    });
    fs.writeFileSync(`scratch/scale_${scale.replace('.', '_')}.png`, Buffer.from(snap.data, 'base64'));
  }

  // Also test mobile at 390px
  console.log(`\n================ Testing Mobile 390px with scale ================`);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 2000));

  const mobileRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const results = {};
        ['0.88em', '0.85em', '0.82em', '0.80em', '0.75em'].forEach(scale => {
          let styleEl = document.getElementById('test-scale-style');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'test-scale-style';
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = \`
            .tp-hero-title .cd-words-wrapper b {
              font-size: \${scale} !important;
            }
          \`;

          const h1 = document.querySelector('.tp-hero-title');
          const wrapper = document.querySelector('.cd-words-wrapper');
          const words = Array.from(document.querySelectorAll('.cd-words-wrapper b'));
          const productWord = words.find(w => w.textContent.includes('PRODUCT'));

          words.forEach(w => {
            w.classList.remove('is-visible');
            w.classList.add('is-hidden');
          });
          productWord.classList.remove('is-hidden');
          productWord.classList.add('is-visible');
          wrapper.style.width = (productWord.offsetWidth + 10) + 'px';

          const splitDiv = h1.querySelector('div');
          const h1Rect = h1.getBoundingClientRect();
          const splitRect = splitDiv ? splitDiv.getBoundingClientRect() : null;

          results[scale] = {
            productWidth: productWord.offsetWidth,
            wrapperWidth: wrapper.offsetWidth,
            h1Height: h1Rect.height,
            wrapped: (splitRect ? splitRect.height : h1Rect.height) > 60
          };
        });
        return results;
      })()
    `,
    returnByValue: true
  });
  console.log('Mobile results:', JSON.stringify(mobileRes.result.value, null, 2));

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
