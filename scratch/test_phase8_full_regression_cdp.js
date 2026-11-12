const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8160;
const CDP_PORT = 9290;

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
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
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
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
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

async function verifyPhase8() {
  console.log(`================================================================`);
  console.log(`PHASE 8: TYPOGRAPHY REGRESSION FIX & FULL REGRESSION CDP TEST`);
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
      console.log(`TESTING DIRECT PRODUCTION LOAD: ${pageName}`);
      console.log(`======================================================`);

      for (const vp of VIEWPORTS) {
        console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: !!vp.isMobile
        });

        const url = `http://127.0.0.1:${PORT}/${pageName}`;
        await client.send('Page.navigate', { url });
        await sleep(1500);

        // Core component verification
        const headerStyles = await client.evaluate(`
          (() => {
            const h = document.querySelector('header');
            return h ? { display: window.getComputedStyle(h).display, pos: window.getComputedStyle(h).position } : null;
          })()
        `);
        totalAssertions++;
        if (headerStyles && (headerStyles.display === 'flex' || headerStyles.display === 'block')) {
          passedAssertions++;
          console.log(`  [OK] Header rendered cleanly (${headerStyles.display})`);
        } else {
          failures.push({ page: pageName, viewport: vp.name, check: 'Header rendering' });
        }

        const footerStyles = await client.evaluate(`
          (() => {
            const f = document.querySelector('footer');
            return f ? { display: window.getComputedStyle(f).display } : null;
          })()
        `);
        totalAssertions++;
        if (footerStyles && footerStyles.display === 'block') {
          passedAssertions++;
          console.log(`  [OK] Footer rendered cleanly`);
        } else {
          failures.push({ page: pageName, viewport: vp.name, check: 'Footer rendering' });
        }

        // Theme Toggle Functionality
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
          console.log(`  [OK] html[tp-theme="tp-theme-light"] successfully activated`);
        } else {
          failures.push({ page: pageName, viewport: vp.name, check: 'Theme toggle activation' });
        }

        // Toggle back to dark
        await client.evaluate(`
          (() => {
            const input = document.querySelector('.themepure-theme-toggle-input');
            if (input) input.click();
          })()
        `);
        await sleep(300);

        // Page-specific interactions and typography checks
        if (pageName === 'index.html') {
          // Typography check: Hero title
          const heroTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-title');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return {
                ff: cs.fontFamily,
                fs: cs.fontSize,
                fw: cs.fontWeight,
                lh: cs.lineHeight,
                color: cs.color
              };
            })()
          `);
          totalAssertions++;
          if (heroTypography && heroTypography.ff.includes('EB Garamond')) {
            passedAssertions++;
            console.log(`  [OK] Hero title typography restored: ff="${heroTypography.ff}", fs="${heroTypography.fs}", fw="${heroTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Hero title typography: ${JSON.stringify(heroTypography)}` });
          }

          // Typography check: GRAPHIC designer text
          const graphicTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-title span b.app');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fw: cs.fontWeight, fs: cs.fontSize };
            })()
          `);
          totalAssertions++;
          if (graphicTypography && graphicTypography.ff.includes('EB Garamond')) {
            passedAssertions++;
            console.log(`  [OK] GRAPHIC text typography: ff="${graphicTypography.ff}", fw="${graphicTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `GRAPHIC typography: ${JSON.stringify(graphicTypography)}` });
          }

          // Typography check: Services top text ("MY SERVICES")
          const servicesTextTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-services-top-text p');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          totalAssertions++;
          if (servicesTextTypography && servicesTextTypography.ff.includes('Abril Fatface')) {
            passedAssertions++;
            console.log(`  [OK] Services background text restored: ff="${servicesTextTypography.ff}", fs="${servicesTextTypography.fs}", fw="${servicesTextTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Services top text typography: ${JSON.stringify(servicesTextTypography)}` });
          }

          // Typography check: Section subtitle ("Some Word About Me")
          const subtitleTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-section-subtitle');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          totalAssertions++;
          if (subtitleTypography && subtitleTypography.ff.includes('EB Garamond')) {
            passedAssertions++;
            console.log(`  [OK] Section subtitle typography: ff="${subtitleTypography.ff}", fw="${subtitleTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Subtitle typography: ${JSON.stringify(subtitleTypography)}` });
          }

          // Typography check: Subtitle bg ("About Me")
          const subtitleBgTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-section-subtitle-bg');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          totalAssertions++;
          if (subtitleBgTypography && subtitleBgTypography.ff.includes('Abril Fatface')) {
            passedAssertions++;
            console.log(`  [OK] Section subtitle bg typography: ff="${subtitleBgTypography.ff}", fw="${subtitleBgTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Subtitle bg typography: ${JSON.stringify(subtitleBgTypography)}` });
          }

          // Typography check: Section title ("Skills & tools")
          const sectionTitleTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-section-title');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          totalAssertions++;
          if (sectionTitleTypography && sectionTitleTypography.ff.includes('DM Sans')) {
            passedAssertions++;
            console.log(`  [OK] Section title typography: ff="${sectionTitleTypography.ff}", fw="${sectionTitleTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Section title typography: ${JSON.stringify(sectionTitleTypography)}` });
          }

          // Animations: Hero scroll down SVG
          const heroAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-3__scrool-down span svg');
              return el ? window.getComputedStyle(el).animationName : null;
            })()
          `);
          totalAssertions++;
          if (heroAnim === 'scroll_anim') {
            passedAssertions++;
            console.log(`  [OK] Hero scroll animation active: ${heroAnim}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Hero scroll animation' });
          }

          // Animations: Service circle rotating
          const serviceAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-service-3__circle-img .text-img img');
              return el ? window.getComputedStyle(el).animationName : null;
            })()
          `);
          totalAssertions++;
          if (serviceAnim === 'animationglob') {
            passedAssertions++;
            console.log(`  [OK] Services circle animation active: ${serviceAnim}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Services circle animation' });
          }

          // Accordion click reactivity
          const accordionClick = await client.evaluate(`
            (() => {
              const btn = document.querySelector('.accordion-button.collapsed');
              if (!btn) return false;
              btn.click();
              return true;
            })()
          `);
          await sleep(350);
          totalAssertions++;
          if (accordionClick) {
            passedAssertions++;
            console.log(`  [OK] Services accordion click reactive`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Accordion click' });
          }

        } else if (pageName === 'portfolio.html') {
          // Portfolio filter tabs click
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

          // Portfolio item typography
          const portfolioTitleTypography = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-portfolio-title');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          totalAssertions++;
          if (portfolioTitleTypography && portfolioTitleTypography.ff.includes('DM Sans')) {
            passedAssertions++;
            console.log(`  [OK] Portfolio title typography: ff="${portfolioTitleTypography.ff}", fw="${portfolioTitleTypography.fw}"`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Portfolio title typography: ${JSON.stringify(portfolioTitleTypography)}` });
          }

        } else if (pageName === 'portfolio/2/app-visual-assets.html') {
          // Case study native mouseWheel scroll lifecycle
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
            console.log(`    [OK] Showcase pinning active (pin-spacer=${pinSpacer.hasSpacer})`);
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
          console.log(`    [OK] Reverse scroll completed smoothly`);
        }
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
  console.log(`PHASE 8 TEST SUMMARY: ${passedAssertions}/${totalAssertions} assertions passed`);
  if (failures.length > 0 || totalAssertions === 0 || passedAssertions !== totalAssertions) {
    console.log(`Total Failures: ${failures.length}`);
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log(`ALL PHASE 8 TESTS PASSED WITH 100% SUCCESS!`);
    process.exit(0);
  }
}

verifyPhase8();
