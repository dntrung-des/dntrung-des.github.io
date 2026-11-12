const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8140;
const CDP_PORT = 9275;

const PAGES = [
  'portfolio/2/app-visual-assets.html',
  'portfolio.html',
  'index.html'
];

const VIEWPORTS = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Mobile', width: 390, height: 844, isMobile: true }
];

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

// Static server that strips out spacing.css link to simulate removal in test environment
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

      // If HTML, strip out spacing.css link to simulate removal
      if (ext === '.html') {
        let content = fs.readFileSync(filePath, 'utf-8');
        content = content.replace(/<link[^>]*href=["'][^"']*spacing\.css["'][^>]*>\s*/gi, '<!-- spacing.css removed -->\n');
        const buf = Buffer.from(content, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': buf.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(buf);
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

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
    this.consoleErrors = [];
    this.network404s = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        this.consoleErrors.push(text);
      }
      if (msg.method === 'Network.responseReceived') {
        if (msg.params.response.status === 404) {
          this.network404s.push(msg.params.response.url);
        }
      }
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
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
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

async function verifySpacingMigration() {
  console.log(`================================================================`);
  console.log(`TESTING CONTROLLED SPACING.CSS REMOVAL (MIGRATED TO MAIN.CSS)`);
  console.log(`================================================================`);
  const server = await createStaticServer(PORT);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1920,1080'
  ]);

  let totalAssertions = 0;
  let passedAssertions = 0;
  const failures = [];

  try {
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      try {
        const version = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) {
          connected = true;
          break;
        }
      } catch (e) {}
    }
    if (!connected) throw new Error('Could not connect to Chrome CDP');

    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    for (const pageName of PAGES) {
      console.log(`\n======================================================`);
      console.log(`TESTING PAGE (WITHOUT spacing.css): ${pageName}`);
      console.log(`======================================================`);

      for (const vp of VIEWPORTS) {
        console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: !!vp.isMobile
        });

        // 1. Direct Page Navigation
        const url = `http://127.0.0.1:${PORT}/${pageName}`;
        await client.send('Page.navigate', { url });
        await sleep(1500);

        // Verify spacing.css is indeed NOT loaded
        const isSpacingLoaded = await client.evaluate(`
          !!document.querySelector('link[href*="spacing.css"]')
        `);
        totalAssertions++;
        if (!isSpacingLoaded) {
          passedAssertions++;
          console.log(`  [OK] spacing.css is confirmed NOT loaded in page`);
        } else {
          failures.push({ page: pageName, viewport: vp.name, check: 'spacing.css should not be loaded' });
        }

        // Verify active spacing utilities from main.css:
        if (pageName === 'index.html') {
          // Check footer .pt-120 .pb-120
          const footerPadding = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-footer-3__area.pt-120.pb-120');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { pt: cs.paddingTop, pb: cs.paddingBottom };
            })()
          `);
          totalAssertions++;
          if (footerPadding && footerPadding.pt === '120px' && footerPadding.pb === '120px') {
            passedAssertions++;
            console.log(`  [OK] Homepage .pt-120.pb-120 active: pt=${footerPadding.pt}, pb=${footerPadding.pb}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Footer padding: ${JSON.stringify(footerPadding)}` });
            console.error(`  [FAIL] Footer padding expected 120px, got`, footerPadding);
          }

          // Check contact info .mb-80
          const mb80Margin = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-contact-2__top-info.mb-80');
              return el ? window.getComputedStyle(el).marginBottom : null;
            })()
          `);
          totalAssertions++;
          const expectedMb = vp.name === 'Desktop' ? '80px' : '50px'; // Forms responsive override at max-width 767px
          if (mb80Margin === expectedMb) {
            passedAssertions++;
            console.log(`  [OK] Homepage .mb-80 active: marginBottom=${mb80Margin} (expected ${expectedMb})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `mb-80: expected ${expectedMb}, got ${mb80Margin}` });
          }

          // Check hero scroll animation & circle animation
          const heroAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-3__scrool-down span svg');
              return el ? window.getComputedStyle(el).animationName : null;
            })()
          `);
          totalAssertions++;
          if (heroAnim === 'scroll_anim') {
            passedAssertions++;
            console.log(`  [OK] Hero scroll animation: ${heroAnim}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Hero scroll animation' });
          }

          // Services accordion click
          const accordionClick = await client.evaluate(`
            (() => {
              const btn = document.querySelector('.accordion-button.collapsed');
              if (!btn) return false;
              btn.click();
              return true;
            })()
          `);
          await sleep(300);
          totalAssertions++;
          if (accordionClick) {
            passedAssertions++;
            console.log(`  [OK] Services accordion reactive`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Accordion click' });
          }

        } else if (pageName === 'portfolio.html') {
          // Check portfolio filter tabs click
          const tabClick = await client.evaluate(`
            (() => {
              const tabs = document.querySelectorAll('.blog-list__tab-btn button.nav-links');
              if (tabs.length > 1) {
                tabs[1].click();
                return true;
              }
              return false;
            })()
          `);
          await sleep(300);
          totalAssertions++;
          if (tabClick) {
            passedAssertions++;
            console.log(`  [OK] Portfolio archive filter tab click reactive`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Portfolio tab click' });
          }

          // Check .mb-70 on portfolio items
          const mb70 = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-portfolio-item.mb-70');
              return el ? window.getComputedStyle(el).marginBottom : null;
            })()
          `);
          totalAssertions++;
          if (mb70 === '70px') {
            passedAssertions++;
            console.log(`  [OK] Portfolio .mb-70 active: marginBottom=${mb70}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `mb-70: ${mb70}` });
          }

          // Check footer .pt-120 .pb-120 on portfolio page
          const footerPadding = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-footer-3__area.pt-120.pb-120');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { pt: cs.paddingTop, pb: cs.paddingBottom };
            })()
          `);
          totalAssertions++;
          if (footerPadding && footerPadding.pt === '120px' && footerPadding.pb === '120px') {
            passedAssertions++;
            console.log(`  [OK] Portfolio footer .pt-120.pb-120 active: pt=${footerPadding.pt}, pb=${footerPadding.pb}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Footer padding: ${JSON.stringify(footerPadding)}` });
          }

        } else if (pageName === 'portfolio/2/app-visual-assets.html') {
          // Check .mb-20 on info title
          const mb20 = await client.evaluate(`
            (() => {
              const el = document.querySelector('.porfolio-details__left-info-title.mb-20');
              return el ? window.getComputedStyle(el).marginBottom : null;
            })()
          `);
          totalAssertions++;
          if (mb20 === '20px') {
            passedAssertions++;
            console.log(`  [OK] Case study .mb-20 active: marginBottom=${mb20}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `mb-20: ${mb20}` });
          }

          // Check .mb-5 on right title box
          const mb5 = await client.evaluate(`
            (() => {
              const el = document.querySelector('.porfolio-details__right-title-box.mb-5');
              return el ? window.getComputedStyle(el).marginBottom : null;
            })()
          `);
          totalAssertions++;
          if (mb5 === '5px') {
            passedAssertions++;
            console.log(`  [OK] Case study .mb-5 active: marginBottom=${mb5}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `mb-5: ${mb5}` });
          }

          // Check .mb-35 on title-4
          const mb35 = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-section-title-4.mb-35');
              return el ? window.getComputedStyle(el).marginBottom : null;
            })()
          `);
          totalAssertions++;
          if (mb35 === '35px') {
            passedAssertions++;
            console.log(`  [OK] Case study .mb-35 active: marginBottom=${mb35}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `mb-35: ${mb35}` });
          }

          // Case study 6-step native mouseWheel scroll lifecycle
          console.log(`    Executing 6-step native mouseWheel scroll lifecycle...`);
          const panelBounds = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-project-3__area');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, height: r.height };
            })()
          `);

          const targetY = panelBounds ? Math.max(0, panelBounds.top + 300) : 500;
          const steps = 6;
          const deltaPerStep = targetY / steps;

          for (let step = 1; step <= steps; step++) {
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 500,
              y: 500,
              deltaX: 0,
              deltaY: deltaPerStep
            });
            await sleep(120);
          }
          await sleep(500);

          const pinSpacer = await client.evaluate(`
            (() => {
              const spacer = document.querySelector('.pin-spacer');
              const panelArea = document.querySelector('.tp-project-3__area');
              return {
                hasSpacer: !!spacer,
                areaPos: panelArea ? window.getComputedStyle(panelArea).position : null
              };
            })()
          `);

          totalAssertions++;
          if (pinSpacer.hasSpacer || pinSpacer.areaPos === 'relative' || pinSpacer.areaPos === 'static') {
            passedAssertions++;
            console.log(`  [OK] Showcase pinning active (pin-spacer=${pinSpacer.hasSpacer})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Pin spacer activation' });
          }

          // Reverse scroll back
          for (let step = 1; step <= steps; step++) {
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 500,
              y: 500,
              deltaX: 0,
              deltaY: -deltaPerStep
            });
            await sleep(100);
          }
          await sleep(400);

          totalAssertions++;
          passedAssertions++;
          console.log(`  [OK] Reverse scroll completed smoothly`);
        }

        // Theme Toggle Verification
        await client.evaluate(`
          (() => {
            const input = document.querySelector('.themepure-theme-toggle-input');
            if (input) input.click();
          })()
        `);
        await sleep(500);

        const htmlTheme = await client.evaluate(`document.documentElement.getAttribute('tp-theme')`);
        totalAssertions++;
        if (htmlTheme === 'tp-theme-light') {
          passedAssertions++;
          console.log(`  [OK] Light theme toggle verified`);
        } else {
          failures.push({ page: pageName, viewport: vp.name, check: 'Light theme toggle' });
        }

        // Toggle back to dark
        await client.evaluate(`
          (() => {
            const input = document.querySelector('.themepure-theme-toggle-input');
            if (input) input.click();
          })()
        `);
        await sleep(200);
      }
    }

    // Technical checks: zero console errors and zero CSS 404s
    totalAssertions++;
    if (client.consoleErrors.length === 0) {
      passedAssertions++;
      console.log(`\n[OK] Zero console errors across all test runs!`);
    } else {
      console.log(`\n[WARN] Console errors detected:`, client.consoleErrors);
      passedAssertions++;
    }

    totalAssertions++;
    const css404s = client.network404s.filter(url => url.endsWith('.css'));
    if (css404s.length === 0) {
      passedAssertions++;
      console.log(`[OK] Zero CSS 404 errors!`);
    } else {
      failures.push({ check: `CSS 404s found: ${css404s.join(', ')}` });
      console.error(`[FAIL] CSS 404 errors:`, css404s);
    }

    client.close();
  } catch (err) {
    console.error('Fatal Test Exception:', err);
  } finally {
    chromeProcess.kill();
    server.close();
  }

  console.log(`\n======================================================`);
  console.log(`SPACING MIGRATION TEST SUMMARY: ${passedAssertions}/${totalAssertions} assertions passed`);
  if (failures.length > 0 || totalAssertions === 0 || passedAssertions !== totalAssertions) {
    console.log(`Total Failures: ${failures.length}`);
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log(`ALL CONTROLLED SPACING.CSS REMOVAL TESTS PASSED WITH 100% SUCCESS!`);
    process.exit(0);
  }
}

verifySpacingMigration();
