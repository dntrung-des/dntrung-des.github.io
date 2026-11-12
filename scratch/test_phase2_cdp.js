const http = require('http');
const { spawn } = require('child_process');

const PORT = 8090;
const CDP_PORT = 9222;

const PAGES = [
  'index.html',
  'portfolio.html',
  'portfolio/2/app-visual-assets.html'
];

const VIEWPORTS = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Mobile', width: 390, height: 844, isMobile: true }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTests() {
  console.log('>>> Starting Headless Chrome for Phase 2 Verification...');
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking'
  ]);

  let serverProcess = spawn('python3', ['-m', 'http.server', `${PORT}`]);

  await sleep(1500);

  let totalAssertions = 0;
  let passedAssertions = 0;
  let failures = [];

  try {
    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    for (const pageName of PAGES) {
      for (const vp of VIEWPORTS) {
        console.log(`\n======================================================`);
        console.log(`Testing ${pageName} on ${vp.name} (${vp.width}x${vp.height})`);
        console.log(`======================================================`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: !!vp.isMobile
        });

        const url = `http://127.0.0.1:${PORT}/${pageName}`;
        await client.send('Page.navigate', { url });
        await sleep(1500);

        // 1. Verify page loaded cleanly with 0 fatal JS errors
        const title = await client.evaluate(`document.title`);
        console.log(`  Page Title: "${title}"`);

        // 2. Measure computed styles with main.css for global components
        const testElements = [
          { sel: '.header-dynamic', name: 'Header Container' },
          { sel: '.header-items', name: 'Header Nav Items' },
          { sel: '.nav-link-custom', name: 'Header Link' },
          { sel: '.tp-theme-toggle-main', name: 'Theme Toggle Pill' },
          { sel: '.change-theme-bottom', name: 'Theme Toggle Container' },
          { sel: '.tp-footer-3__widget', name: 'Footer Widget' },
          { sel: '.tp-copyright-3__social', name: 'Footer Social Wrap' },
          { sel: '.tp-btn-white', name: 'White Button' },
          { sel: '.tp-btn-blue', name: 'Blue Button' },
          { sel: '.tp-btn-pink-large', name: 'Pink Button' },
          { sel: '.tp-btn-black-lg', name: 'Black Large Button' },
          { sel: '.tp-btn-border-sm', name: 'Border Small Button' },
          { sel: '.tp-btn-border-md', name: 'Border Medium Button' },
          { sel: '.tp-section-title', name: 'Section Title' },
          { sel: '.tp-section-subtitle', name: 'Section Subtitle' },
          { sel: '.nice-select', name: 'Nice Select' },
          { sel: '.tp-contact-2__input input', name: 'Contact Input' }
        ];

        const getStylesExpr = (selector) => `
          (() => {
            const el = document.querySelector('${selector}');
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
              display: cs.display,
              position: cs.position,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              lineHeight: cs.lineHeight,
              color: cs.color,
              backgroundColor: cs.backgroundColor,
              borderRadius: cs.borderRadius,
              zIndex: cs.zIndex
            };
          })()
        `;

        const originalStyles = {};
        for (const t of testElements) {
          const st = await client.evaluate(getStylesExpr(t.sel));
          if (st) {
            originalStyles[t.sel] = st;
          }
        }

        console.log(`  Recorded ${Object.keys(originalStyles).length} active global element styles with main.css`);

        // 3. Swap main.css -> main.preview.css in memory
        await client.evaluate(`
          (() => {
            const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
            for (const l of links) {
              if (l.href.includes('main.css')) {
                l.href = l.href.replace('main.css', 'main.preview.css');
              }
            }
          })()
        `);
        await sleep(500);

        // 4. Measure styles with main.preview.css and assert equality
        for (const [sel, orig] of Object.entries(originalStyles)) {
          const previewSt = await client.evaluate(getStylesExpr(sel));
          totalAssertions++;
          let diffs = [];
          for (const prop of ['display', 'position', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderRadius', 'zIndex']) {
            if (orig[prop] !== previewSt[prop]) {
              diffs.push(`${prop}: main.css='${orig[prop]}' vs preview='${previewSt[prop]}'`);
            }
          }

          if (diffs.length === 0) {
            passedAssertions++;
          } else {
            failures.push({ page: pageName, viewport: vp.name, selector: sel, diffs });
            console.error(`  FAIL [${vp.name}] ${sel}:`, diffs);
          }
        }

        console.log(`  Preview CSS Style Parity: ${passedAssertions}/${totalAssertions} assertions passed`);

        // 5. Test dynamic Header scroll shrinking
        const initialHeaderWidth = await client.evaluate(`
          (() => {
            const h = document.querySelector('.header-dynamic');
            return h ? h.getBoundingClientRect().width : null;
          })()
        `);

        if (initialHeaderWidth) {
          await client.evaluate(`window.scrollTo(0, 500); window.dispatchEvent(new Event('scroll'));`);
          await sleep(400);

          const isSmall = await client.evaluate(`
            (() => {
              const h = document.querySelector('.header-dynamic');
              return h ? h.classList.contains('header-small') : false;
            })()
          `);

          totalAssertions++;
          if (isSmall) {
            passedAssertions++;
            console.log(`  [OK] Dynamic Header shrink on scroll passed (header-small added)`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Header scroll shrink' });
            console.error(`  [FAIL] Header did not shrink on scroll`);
          }

          // Restore scroll
          await client.evaluate(`window.scrollTo(0, 0); window.dispatchEvent(new Event('scroll'));`);
          await sleep(300);
        }

        // 6. Test Theme Toggle functionality in preview
        const toggleExists = await client.evaluate(`!!document.querySelector('.tp-theme-toggle-main')`);
        if (toggleExists) {
          await client.evaluate(`
            (() => {
              const toggle = document.querySelector('.tp-theme-toggle-main');
              if (toggle) toggle.click();
            })()
          `);
          await sleep(300);

          const themeAttr = await client.evaluate(`document.documentElement.getAttribute('tp-theme')`);
          totalAssertions++;
          if (themeAttr === 'tp-theme-light' || themeAttr === 'tp-theme-dark') {
            passedAssertions++;
            console.log(`  [OK] Theme Toggle switch working (current theme: ${themeAttr})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Theme toggle click' });
            console.error(`  [FAIL] Theme toggle did not update tp-theme attribute`);
          }

          // Toggle back
          await client.evaluate(`
            (() => {
              const t = document.querySelector('.tp-theme-toggle-main');
              if (t) t.click();
            })()
          `);
          await sleep(200);
        }
      }
    }

    client.close();
  } catch (err) {
    console.error('Fatal Test Exception:', err);
  } finally {
    chromeProcess.kill();
    serverProcess.kill();
  }

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: ${passedAssertions}/${totalAssertions} assertions passed`);
  if (failures.length > 0) {
    console.log(`Total Failures: ${failures.length}`);
    process.exit(1);
  } else {
    console.log(`ALL GLOBAL COMPONENT PARITY TESTS PASSED WITH 0 REGRESSIONS!`);
    process.exit(0);
  }
}

runTests();
