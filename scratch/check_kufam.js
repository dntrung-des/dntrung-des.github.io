const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function test() {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200);
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise(r => server.listen(8172, r));

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, ['--remote-debugging-port=9297', '--headless=new', '--disable-gpu', '--no-sandbox']);
  await new Promise(r => setTimeout(r, 1000));

  const httpGet = url => new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const version = await httpGet('http://127.0.0.1:9297/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const send = (method, params = {}) => new Promise(resolve => {
    const curId = id++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        ws.removeEventListener('message', handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  const targets = await httpGet('http://127.0.0.1:9297/json/list');
  const pageTarget = targets.find(t => t.type === 'page');
  const pageWs = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => pageWs.onopen = r);

  const pageSend = (method, params = {}) => new Promise(resolve => {
    const curId = id++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        pageWs.removeEventListener('message', handler);
        resolve(msg.result);
      }
    };
    pageWs.addEventListener('message', handler);
    pageWs.send(JSON.stringify({ id: curId, method, params }));
  });

  await pageSend('Page.navigate', { url: 'http://127.0.0.1:8172/index.html' });
  await new Promise(r => setTimeout(r, 1500));

  const evalRes = await pageSend('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.tp-contact-2__top-info a span');
      return el ? {
        text: el.textContent,
        fontFamily: window.getComputedStyle(el).fontFamily
      } : null;
    })()`,
    returnByValue: true
  });

  console.log("tp-contact-2__top-info a span:", evalRes.result.value);

  ws.close();
  pageWs.close();
  chromeProcess.kill();
  server.close();
}

test().catch(console.error);
