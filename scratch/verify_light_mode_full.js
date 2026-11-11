const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 8628;
const CDP_PORT = 9718;

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
    `--user-data-dir=/tmp/chrome-light-verif-${CDP_PORT}`
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

  // Toggle to light mode using the site toggle button or attribute
  await send('Runtime.evaluate', {
    expression: `(() => {
      const toggle = document.querySelector(".tp-theme-toggle-main");
      if (toggle) toggle.click();
      else document.documentElement.setAttribute("tp-theme", "tp-theme-light");
    })()`
  });
  await new Promise(r => setTimeout(r, 600));

  const checkResults = (await send('Runtime.evaluate', {
    expression: `(() => {
      const html = document.documentElement;
      const computedRoot = window.getComputedStyle(html);
      const black5 = computedRoot.getPropertyValue("--tp-common-black-5").trim();

      const resumeBtn = document.querySelector(".tp-btn-border-sm");
      const resumeStyle = window.getComputedStyle(resumeBtn);

      const blueBtn = document.querySelector(".tp-btn-blue");
      const blueStyle = window.getComputedStyle(blueBtn);

      const cursorCircle = document.getElementById("awesome-cursor-circle");
      const cursorBg = cursorCircle ? window.getComputedStyle(cursorCircle).backgroundColor : null;

      return {
        themeAttr: html.getAttribute("tp-theme"),
        black5Value: black5,
        resumeBtn: {
          color: resumeStyle.color,
          bg: resumeStyle.backgroundColor,
          border: resumeStyle.borderColor
        },
        blueBtnNormal: {
          color: blueStyle.color,
          afterBg: window.getComputedStyle(blueBtn, "::after").backgroundColor
        },
        cursorBg
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('LIGHT MODE CHECK RESULTS:', JSON.stringify(checkResults, null, 2));

  // Hover over blue button
  const bluePos = (await send('Runtime.evaluate', {
    expression: `(() => {
      const r = document.querySelector(".tp-btn-blue").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
    returnByValue: true
  })).result.value;

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bluePos.x, y: bluePos.y });
  await new Promise(r => setTimeout(r, 500));

  const blueHover = (await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector(".tp-btn-blue");
      const text = btn.querySelector(".text");
      const textAfter = window.getComputedStyle(text, "::after");
      return {
        btnColor: window.getComputedStyle(btn).color,
        textAfterBg: textAfter.backgroundColor
      };
    })()`,
    returnByValue: true
  })).result.value;

  console.log('BLUE HOVER IN LIGHT MODE:', JSON.stringify(blueHover, null, 2));

  // Capture final screenshot of hero in light mode
  const resHero = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 300, y: 150, width: 800, height: 500, scale: 1 }
  });
  fs.writeFileSync('scratch/final_verified_light_mode_hero.png', Buffer.from(resHero.data, 'base64'));

  ws.close();
  proc.kill();
  server.close();
}
run().catch(console.error);
