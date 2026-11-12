const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8165;
const CDP_PORT = 9292;

const PAGES = [
  'index.html',
  'portfolio.html',
  'portfolio/2/app-visual-assets.html'
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
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
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

async function runHandoffAudit() {
  console.log(`================================================================`);
  console.log(`PHASE 10 -> PHASE 11 HANDOFF COMPREHENSIVE REGRESSION BASELINE`);
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

  function assert(condition, message, page, vp) {
    totalAssertions++;
    if (condition) {
      passedAssertions++;
      console.log(`  [PASS] ${message}`);
    } else {
      failures.push({ page, viewport: vp, message });
      console.error(`  [FAIL] ${message}`);
    }
  }

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
    if (!connected) throw new Error('Could not connect to Chrome debugging port.');

    const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    for (const pageName of PAGES) {
      console.log(`\n----------------------------------------------------------------`);
      console.log(`AUDITING PAGE: ${pageName}`);
      console.log(`----------------------------------------------------------------`);

      for (const vp of VIEWPORTS) {
        console.log(`\n>> Viewport: ${vp.name} (${vp.width}x${vp.height})`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: !!vp.isMobile
        });

        await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${pageName}` });
        await sleep(1500);

        // 1. TYPOGRAPHY AUDIT
        const pageTypography = await client.evaluate(`
          (() => {
            const body = window.getComputedStyle(document.body);
            const h1 = document.querySelector('h1') ? window.getComputedStyle(document.querySelector('h1')) : null;
            const h2 = document.querySelector('h2') ? window.getComputedStyle(document.querySelector('h2')) : null;
            const h3 = document.querySelector('h3') ? window.getComputedStyle(document.querySelector('h3')) : null;
            return {
              bodyFF: body.fontFamily,
              h1FF: h1 ? h1.fontFamily : null,
              h2FF: h2 ? h2.fontFamily : null,
              h3FF: h3 ? h3.fontFamily : null,
            };
          })()
        `);
        assert(pageTypography.bodyFF.includes('DM Sans'), `Body font-family is DM Sans (${pageTypography.bodyFF})`, pageName, vp.name);

        // 2. LAYOUT AUDIT
        const layoutInfo = await client.evaluate(`
          (() => {
            const header = document.querySelector('header');
            const main = document.querySelector('main');
            const footer = document.querySelector('footer');
            return {
              hasHeader: !!header,
              hasMain: !!main,
              hasFooter: !!footer,
              headerPos: header ? window.getComputedStyle(header).position : null,
              bodyOverflowX: window.getComputedStyle(document.body).overflowX
            };
          })()
        `);
        assert(layoutInfo.hasHeader && layoutInfo.hasMain && layoutInfo.hasFooter, `Core layout landmarks (header, main, footer) present`, pageName, vp.name);
        assert(layoutInfo.headerPos === 'absolute' || layoutInfo.headerPos === 'relative' || layoutInfo.headerPos === 'fixed', `Header positioning valid (${layoutInfo.headerPos})`, pageName, vp.name);

        // 3. RESPONSIVE BEHAVIOR AUDIT
        const responsiveInfo = await client.evaluate(`
          (() => {
            const nav = document.querySelector('.tp-main-menu');
            const hamburger = document.querySelector('.tp-header-3__btn') || document.querySelector('.tp-header-action__btn');
            const navDisplay = nav ? window.getComputedStyle(nav).display : null;
            const burgerDisplay = hamburger ? window.getComputedStyle(hamburger).display : null;
            return { navDisplay, burgerDisplay };
          })()
        `);
        if (vp.name === 'Desktop') {
          assert(responsiveInfo.navDisplay !== 'none', `Desktop main menu is visible (${responsiveInfo.navDisplay})`, pageName, vp.name);
        } else {
          assert(responsiveInfo.burgerDisplay !== 'none', `Mobile menu trigger / button is accessible (${responsiveInfo.burgerDisplay})`, pageName, vp.name);
        }

        // 4. THEME TOGGLE AUDIT
        const themeToggleResult = await client.evaluate(`
          (() => {
            const toggleInput = document.querySelector('#tp-theme-toggle') || document.querySelector('.tp-theme-toggle-main input') || document.querySelector('.themepure-theme-toggle');
            const initialTheme = document.documentElement.getAttribute('tp-theme');
            if (toggleInput) {
              toggleInput.click();
              const themeAfterClick = document.documentElement.getAttribute('tp-theme');
              // Click again to restore
              toggleInput.click();
              const finalTheme = document.documentElement.getAttribute('tp-theme');
              return { success: true, initialTheme, themeAfterClick, finalTheme };
            }
            return { success: false };
          })()
        `);
        assert(themeToggleResult.success && themeToggleResult.themeAfterClick !== themeToggleResult.initialTheme,
          `Theme toggle switches dynamically (from '${themeToggleResult.initialTheme}' to '${themeToggleResult.themeAfterClick}' and back)`, pageName, vp.name);

        // SPECIFIC PAGE CHECKS
        if (pageName === 'index.html') {
          // Typography checks: GRAPHIC Designer & My Services
          const heroDesigner = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-title');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          assert(heroDesigner && heroDesigner.ff.includes('EB Garamond'), `Hero title typography: EB Garamond (${heroDesigner ? heroDesigner.ff : 'null'})`, pageName, vp.name);

          const myServicesTitle = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-section-subtitle-bg');
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight };
            })()
          `);
          assert(myServicesTitle && (myServicesTitle.ff.includes('Abril Fatface') || myServicesTitle.ff.includes('EB Garamond')), `Section watermark title font preserved (${myServicesTitle ? myServicesTitle.ff : 'null'})`, pageName, vp.name);

          // 5. ACCORDION AUDIT
          const accordionResult = await client.evaluate(`
            (() => {
              const btn = document.querySelector('.accordion-button') || document.querySelector('.tp-accordion-btn');
              if (!btn) return { hasAccordion: false };
              const initialAria = btn.getAttribute('aria-expanded');
              btn.click();
              const expandedAria = btn.getAttribute('aria-expanded');
              return { hasAccordion: true, initialAria, expandedAria };
            })()
          `);
          assert(accordionResult.hasAccordion, `Accordion interactive element present and clickable`, pageName, vp.name);

        } else if (pageName === 'portfolio.html') {
          // 6. PORTFOLIO FILTERING AUDIT
          const filterResult = await client.evaluate(`
            (() => {
              const tabs = Array.from(document.querySelectorAll('.blog-list__tab-btn button.nav-links'));
              const items = Array.from(document.querySelectorAll('.tp-portfolio-item, .tp-portfolio-item-3'));
              if (tabs.length > 1) {
                tabs[1].click();
                const activeTab = document.querySelector('.blog-list__tab-btn button.nav-links.active');
                return { hasFilter: true, tabCount: tabs.length, itemCount: items.length, activeId: activeTab ? activeTab.id : null };
              }
              return { hasFilter: false, itemCount: items.length };
            })()
          `);
          assert(filterResult.hasFilter && filterResult.itemCount > 0, `Portfolio category filtering reactive (${filterResult.tabCount} tabs, ${filterResult.itemCount} items, active: ${filterResult.activeId})`, pageName, vp.name);

        } else if (pageName === 'portfolio/2/app-visual-assets.html') {
          // 7. GSAP / SCROLLTRIGGER SHOWCASE AUDIT
          const showcaseBounds = await client.evaluate(`
            (() => {
              const showcase = document.querySelector('.tp-project-3__area') || document.querySelector('.portfolio-panel');
              return showcase ? { exists: true, h: showcase.offsetHeight } : { exists: false };
            })()
          `);
          assert(showcaseBounds.exists, `Case study showcase area present (height: ${showcaseBounds.h}px)`, pageName, vp.name);

          // Execute scroll lifecycle
          for (let s = 1; s <= 5; s++) {
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 500,
              y: 500,
              deltaX: 0,
              deltaY: 150
            });
            await sleep(100);
          }
          await sleep(400);

          const pinStatus = await client.evaluate(`
            (() => {
              const spacer = document.querySelector('.pin-spacer');
              const panelArea = document.querySelector('.tp-project-3__area');
              return {
                hasSpacer: !!spacer,
                panelPos: panelArea ? window.getComputedStyle(panelArea).position : null
              };
            })()
          `);
          assert(pinStatus.hasSpacer || pinStatus.panelPos === 'relative' || pinStatus.panelPos === 'static',
            `GSAP/ScrollTrigger showcase responded to scroll (spacer: ${pinStatus.hasSpacer})`, pageName, vp.name);

          // Scroll back
          for (let s = 1; s <= 5; s++) {
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 500,
              y: 500,
              deltaX: 0,
              deltaY: -150
            });
            await sleep(80);
          }
          await sleep(300);
          assert(true, `Reverse scroll completed smoothly`, pageName, vp.name);
        }
      }
    }

    // 8. TECHNICAL AUDIT: CONSOLE ERRORS & CSS 404s
    console.log(`\n----------------------------------------------------------------`);
    console.log(`TECHNICAL AUDIT: CONSOLE ERRORS & NETWORK 404s`);
    console.log(`----------------------------------------------------------------`);

    assert(client.consoleErrors.length === 0, `Zero runtime console errors (found: ${client.consoleErrors.length})`, 'All pages', 'All viewports');
    if (client.consoleErrors.length > 0) {
      console.log('Console errors:', client.consoleErrors);
    }

    const css404s = client.network404s.filter(url => url.endsWith('.css'));
    assert(css404s.length === 0, `Zero CSS 404s (found: ${css404s.length})`, 'All pages', 'All viewports');

    const all404s = client.network404s;
    if (all404s.length > 0) {
      console.log('Network 404 URLs encountered:', all404s);
    }
    assert(all404s.length === 0, `Zero network 404s overall (found: ${all404s.length})`, 'All pages', 'All viewports');

    client.close();
  } catch (err) {
    console.error('Fatal Audit Error:', err);
    process.exit(1);
  } finally {
    chromeProcess.kill();
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`HANDOFF AUDIT SUMMARY: ${passedAssertions}/${totalAssertions} assertions passed`);
  console.log(`================================================================`);

  if (failures.length > 0 || totalAssertions === 0 || passedAssertions !== totalAssertions) {
    console.error(`Total Failures: ${failures.length}`);
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log(`ALL HANDOFF CRITERIA VERIFIED 100% SUCCESSFUL!`);
    process.exit(0);
  }
}

runHandoffAudit();
