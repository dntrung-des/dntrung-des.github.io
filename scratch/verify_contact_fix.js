const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8189;
const CDP_PORT = 9261;

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
    '--user-data-dir=/tmp/chrome_test_profile_8189',
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
  const consoleMessages = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(msg.params);
    }
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

  async function inspect(label, width, height, theme) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1200));

    if (theme === 'light') {
      await send('Runtime.evaluate', {
        expression: `document.documentElement.setAttribute('tp-theme', 'tp-theme-light');`
      });
      await new Promise(r => setTimeout(r, 200));
    }

    // Check DOM attributes and computed styles
    const res = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const form = document.querySelector('#contact-form');
          const nameInput = document.querySelector('#contact-name');
          const emailInput = document.querySelector('#contact-email');
          const select = document.querySelector('#contact-subject');
          const selectWrap = document.querySelector('.tp-contact-2__select');
          const textarea = document.querySelector('#contact-message');
          const btn = document.querySelector('#contact-submit-btn');

          const formRect = form ? form.getBoundingClientRect() : null;
          const selectRect = select ? select.getBoundingClientRect() : null;
          const btnRect = btn ? btn.getBoundingClientRect() : null;

          return {
            formExists: !!form,
            formId: form ? form.id : null,
            formAction: form ? form.getAttribute('action') : null,
            formMethod: form ? form.getAttribute('method') : null,
            nameAttributes: nameInput ? {
              name: nameInput.name,
              type: nameInput.type,
              required: nameInput.required,
              ariaLabel: nameInput.getAttribute('aria-label')
            } : null,
            emailAttributes: emailInput ? {
              name: emailInput.name,
              type: emailInput.type,
              required: emailInput.required,
              ariaLabel: emailInput.getAttribute('aria-label')
            } : null,
            selectAttributes: select ? {
              name: select.name,
              tagName: select.tagName,
              optionsCount: select.options.length,
              options: Array.from(select.options).map(o => ({ value: o.value, text: o.text })),
              ariaLabel: select.getAttribute('aria-label')
            } : null,
            textareaAttributes: textarea ? {
              name: textarea.name,
              required: textarea.required,
              ariaLabel: textarea.getAttribute('aria-label')
            } : null,
            selectRect: selectRect ? { width: selectRect.width, height: selectRect.height } : null,
            selectStyle: select ? {
              height: window.getComputedStyle(select).height,
              fontSize: window.getComputedStyle(select).fontSize,
              color: window.getComputedStyle(select).color,
              appearance: window.getComputedStyle(select).appearance || window.getComputedStyle(select).webkitAppearance
            } : null,
            btnStyle: btn ? {
              tagName: btn.tagName,
              type: btn.type,
              width: btnRect.width,
              height: btnRect.height,
              fontSize: window.getComputedStyle(btn).fontSize,
              lineHeight: window.getComputedStyle(btn).lineHeight,
              backgroundColor: window.getComputedStyle(btn).backgroundColor,
              color: window.getComputedStyle(btn).color,
              cursor: window.getComputedStyle(btn).cursor
            } : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log(`\n=== [${label}] Metrics ===`);
    console.log(JSON.stringify(res.result.value, null, 2));

    // Test selection interaction
    const selectTest = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const select = document.querySelector('#contact-subject');
          if (!select) return { error: 'select not found' };
          
          // Initial value
          const initialVal = select.value;
          
          // Select 'Recruitment'
          select.value = 'Recruitment';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          const afterSelectVal = select.value;
          const afterSelectText = select.options[select.selectedIndex].text;

          // Select 'Project Inquiry'
          select.value = 'Project Inquiry';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          const finalVal = select.value;
          const finalText = select.options[select.selectedIndex].text;

          return {
            initialVal,
            afterSelectVal,
            afterSelectText,
            finalVal,
            finalText,
            success: afterSelectVal === 'Recruitment' && finalVal === 'Project Inquiry'
          };
        })()
      `,
      returnByValue: true
    });
    console.log(`[${label}] Select interaction test:`, selectTest.result.value);

    // Test form submit interception & mailto generation
    const submitTest = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const form = document.querySelector('#contact-form');
          const nameInput = document.querySelector('#contact-name');
          const emailInput = document.querySelector('#contact-email');
          const select = document.querySelector('#contact-subject');
          const textarea = document.querySelector('#contact-message');
          const btn = document.querySelector('#contact-submit-btn');

          nameInput.value = 'Test User';
          emailInput.value = 'test@example.com';
          select.value = 'Recruitment';
          textarea.value = 'Hello, this is a test message.';

          let capturedUrl = null;
          const origLocation = window.location.href;
          
          // Monkeypatch location or test submit handler
          // In submit handler: mailtoUrl is assigned to window.location.href
          // Let's create an event and spy on mailto creation logic
          let statusText = '';
          const statusEl = document.querySelector('#contact-form-status');

          btn.click(); // Trigger form submit via button click!
          
          if (statusEl) {
            statusText = statusEl.textContent;
          }

          return {
            submittedValues: {
              name: nameInput.value,
              email: emailInput.value,
              subject: select.value,
              message: textarea.value
            },
            statusText: statusText,
            buttonType: btn.type,
            formValid: form.checkValidity()
          };
        })()
      `,
      returnByValue: true
    });
    console.log(`[${label}] Form submit test:`, submitTest.result.value);

    // Capture screenshot of contact form
    const clipRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('#contact');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 900) };
        })()
      `,
      returnByValue: true
    });

    if (clipRes.result.value) {
      const clip = clipRes.result.value;
      const snap = await send('Page.captureScreenshot', {
        clip: {
          x: Math.max(0, clip.x),
          y: Math.max(0, clip.y),
          width: clip.width,
          height: clip.height,
          scale: 1
        }
      });
      fs.writeFileSync(`scratch/contact_postfix_${label}.png`, Buffer.from(snap.data, 'base64'));
    }
  }

  await inspect('desktop_dark', 1920, 1080, 'dark');
  await inspect('desktop_light', 1920, 1080, 'light');
  await inspect('mobile_dark', 390, 844, 'dark');
  await inspect('mobile_light', 390, 844, 'light');

  console.log('\nTotal Console Messages recorded during test:', consoleMessages.length);
  if (consoleMessages.length > 0) {
    console.log(consoleMessages);
  }

  ws.close();
  chromeProcess.kill();
  server.close();
}

run().catch(console.error);
