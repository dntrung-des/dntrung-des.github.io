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

async function audit() {
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
  const consoleLogs = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push({ type: msg.params.type, text: (msg.params.args || []).map(a => a.value || a.description).join(' ') });
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
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Audit Contact Form & NiceSelect dropdown
  const dropdownAudit = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const selectNative = document.querySelector('.tp-contact-2__select select');
        const niceSelect = document.querySelector('.tp-contact-2__select .nice-select');
        const currentText = niceSelect ? niceSelect.querySelector('.current')?.innerText : null;
        const options = niceSelect ? Array.from(niceSelect.querySelectorAll('.list .option')).map(o => ({ text: o.innerText, value: o.getAttribute('data-value'), selected: o.classList.contains('selected'), focus: o.classList.contains('focus') })) : [];

        // Check if nice-select is initialized by niceSelect plugin or if it's static HTML
        const hasPlugin = typeof jQuery !== 'undefined' && typeof jQuery.fn.niceSelect === 'function';

        // Try clicking nice-select
        let openClassBefore = niceSelect ? niceSelect.className : null;
        if (niceSelect) {
          niceSelect.click();
        }
        let openClassAfter = niceSelect ? niceSelect.className : null;

        // Try clicking an option
        let optionClicked = false;
        let selectedAfter = null;
        if (niceSelect && options.length > 1) {
          const secondOption = niceSelect.querySelectorAll('.list .option')[1];
          if (secondOption) {
            secondOption.click();
            optionClicked = true;
            selectedAfter = niceSelect.querySelector('.current')?.innerText;
          }
        }

        // Check form submission button & form action
        const form = document.querySelector('.tp-contact-2__bottom-info form');
        const submitBtn = form ? form.querySelector('.tp-btn-pink-large, button, input[type="submit"]') : null;

        return {
          hasPlugin,
          selectNative: selectNative ? { display: window.getComputedStyle(selectNative).display, value: selectNative.value, options: Array.from(selectNative.options).map(o => o.text) } : null,
          niceSelect: {
            exists: !!niceSelect,
            openClassBefore,
            openClassAfter,
            currentText,
            options,
            optionClicked,
            selectedAfter
          },
          form: form ? {
            action: form.getAttribute('action'),
            method: form.getAttribute('method'),
            inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(i => ({ tag: i.tagName, type: i.type, placeholder: i.placeholder, name: i.name })),
            submitBtn: submitBtn ? { tag: submitBtn.tagName, href: submitBtn.getAttribute('href'), text: submitBtn.innerText.trim(), className: submitBtn.className } : null
          } : null
        };
      })()
    `,
    returnByValue: true
  });

  console.log('--- DROPDOWN & FORM AUDIT ---');
  console.log(JSON.stringify(dropdownAudit.result.value, null, 2));

  // 2. Audit All Links on index.html
  const linkAudit = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const links = Array.from(document.querySelectorAll('a')).map(a => ({
          href: a.getAttribute('href'),
          text: a.innerText.replace(/\\s+/g, ' ').trim(),
          target: a.getAttribute('target'),
          outerHTML: a.outerHTML.slice(0, 120)
        }));

        // Filter out empty or hash links
        const brokenOrSuspicious = links.filter(l => {
          if (!l.href) return true;
          if (l.href === '#' || l.href.startsWith('#/')) return true;
          if (l.text.includes('//////')) return true;
          return false;
        });

        return {
          totalLinks: links.length,
          brokenOrSuspicious,
          allLinks: links
        };
      })()
    `,
    returnByValue: true
  });

  console.log('--- LINK AUDIT ---');
  console.log('Broken/Suspicious:', JSON.stringify(linkAudit.result.value.brokenOrSuspicious, null, 2));

  // 3. Audit Gradient & Colors
  const gradientAudit = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        const matches = [];
        allElements.forEach(el => {
          const comp = window.getComputedStyle(el);
          const bg = comp.backgroundImage || '';
          if (bg.includes('5a3aff') || bg.includes('ac13f8') || bg.includes('91deg')) {
            matches.push({
              tag: el.tagName,
              class: el.className,
              bg: bg,
              text: el.innerText ? el.innerText.slice(0, 50) : ''
            });
          }
        });
        return matches;
      })()
    `,
    returnByValue: true
  });

  console.log('--- GRADIENT AUDIT ---');
  console.log(JSON.stringify(gradientAudit.result.value, null, 2));

  // 4. Audit Template Debris & Texts
  const copyAudit = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const bodyText = document.body.innerText;
        const checks = {
          hasLorem: /lorem\\s+ipsum/i.test(bodyText),
          hasThemepure: /themepure/i.test(bodyText),
          hasGenericEmail: /info@example/i.test(bodyText),
          aboutText: document.querySelector('.tp-about-inner')?.innerText.slice(0, 400),
          heroSubtitle: document.querySelector('.tp-hero-3__btn-box')?.innerText,
          heroDesc: document.querySelector('.tp-hero-3__btn-box.tp_wrap_anim p')?.innerText,
          servicesTitle: document.querySelector('.tp-services-title')?.innerText,
          projectTitle: document.querySelector('.tp-project-3__title')?.innerText
        };
        return checks;
      })()
    `,
    returnByValue: true
  });

  console.log('--- COPY & CONTENT AUDIT ---');
  console.log(JSON.stringify(copyAudit.result.value, null, 2));

  ws.close();
  chromeProcess.kill();
  server.close();
  process.exit(0);
}

audit().catch(console.error);
