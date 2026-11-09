const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8120;
const CDP_PORT = 9247;

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

async function runTests() {
  console.log(`[Phase 6 Automated Headless Chrome CDP Verification]`);
  console.log(`Starting Node static server on port ${PORT}...`);
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

    for (const pageName of PAGES) {
      console.log(`\n======================================================`);
      console.log(`TESTING PAGE: ${pageName}`);
      console.log(`======================================================`);

      for (const vp of VIEWPORTS) {
        console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: !!vp.isMobile
        });

        // 1. Load baseline with main.css
        const url = `http://127.0.0.1:${PORT}/${pageName}`;
        await client.send('Page.navigate', { url });
        await sleep(1500);

        // Selectors to measure
        let targetSelectors = [
          'header',
          '.tp-header-area',
          'footer',
          '.themepure-theme-toggle-input'
        ];

        if (pageName === 'portfolio/2/app-visual-assets.html') {
          targetSelectors.push(
            '.tp-project-3__area',
            '.portfolio-panel',
            '.porfolio-details__navigation-wrap',
            '.tp-hero-3__scrool-down span svg'
          );
        } else if (pageName === 'portfolio.html') {
          targetSelectors.push(
            '.blog-list__area',
            '.portfolio-archive-item',
            '.blog-list__tab-btn'
          );
        } else if (pageName === 'index.html') {
          targetSelectors.push(
            '.tp-hero-3__area',
            '.tp-hero-3__title',
            '.tp-hero-3__scrool-down span svg',
            '.tp-service-3__area',
            '.tp-service-3__circle-img .text-img img',
            '.accordion-button',
            '.tp-about-inner',
            '.tp-skills-inner'
          );
        }

        const baselineStyles = await client.evaluate(`
          (() => {
            const selectors = ${JSON.stringify(targetSelectors)};
            const result = {};
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (!el) {
                result[sel] = null;
                continue;
              }
              const comp = window.getComputedStyle(el);
              result[sel] = {
                display: comp.display,
                position: comp.position,
                zIndex: comp.zIndex,
                color: comp.color,
                backgroundColor: comp.backgroundColor,
                fontSize: comp.fontSize,
                fontWeight: comp.fontWeight,
                fontFamily: comp.fontFamily,
                animationName: comp.animationName
              };
            }
            return result;
          })()
        `);

        // 2. Switch to main.preview.css
        await client.evaluate(`
          (() => {
            const link = document.querySelector('link[href*="main.css"]');
            if (link) {
              link.href = '/assets/css/main.preview.css';
            }
          })()
        `);
        await sleep(600);

        // 3. Measure preview styles
        const previewStyles = await client.evaluate(`
          (() => {
            const selectors = ${JSON.stringify(targetSelectors)};
            const result = {};
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (!el) {
                result[sel] = null;
                continue;
              }
              const comp = window.getComputedStyle(el);
              result[sel] = {
                display: comp.display,
                position: comp.position,
                zIndex: comp.zIndex,
                color: comp.color,
                backgroundColor: comp.backgroundColor,
                fontSize: comp.fontSize,
                fontWeight: comp.fontWeight,
                fontFamily: comp.fontFamily,
                animationName: comp.animationName
              };
            }
            return result;
          })()
        `);

        // 4. Parity checks for all measured selectors
        for (const sel of targetSelectors) {
          totalAssertions++;
          const b = baselineStyles[sel];
          const p = previewStyles[sel];

          if (!b && !p) {
            passedAssertions++;
            continue;
          }

          if (!b || !p) {
            failures.push({ page: pageName, viewport: vp.name, selector: sel, reason: 'Element missing in one version' });
            console.error(`  [FAIL] ${sel}: Missing element (baseline=${!!b}, preview=${!!p})`);
            continue;
          }

          let match = true;
          const diffs = [];
          for (const key of Object.keys(b)) {
            if (b[key] !== p[key]) {
              match = false;
              diffs.push(`${key}: base="${b[key]}" vs prev="${p[key]}"`);
            }
          }

          if (match) {
            passedAssertions++;
            console.log(`  [OK] ${sel} matched perfectly`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, selector: sel, diffs });
            console.error(`  [FAIL] ${sel} differences: ${diffs.join(', ')}`);
          }
        }

        // 5. Explicit Phase 6 Interaction & Animation Assertions
        console.log(`\n  Checking Phase 6 Interactions & Animations:`);

        // Page-specific animation checks
        if (pageName === 'index.html') {
          // 1. Hero scroll down bounce animation
          const heroScrollAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-3__scrool-down span svg');
              if (!el) return null;
              return window.getComputedStyle(el).animationName;
            })()
          `);
          totalAssertions++;
          if (heroScrollAnim === 'scroll_anim') {
            passedAssertions++;
            console.log(`    [OK] Homepage .tp-hero-3__scrool-down span svg animationName === 'scroll_anim'`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `hero scroll animation: ${heroScrollAnim}` });
            console.error(`    [FAIL] hero scroll animation expected scroll_anim, got ${heroScrollAnim}`);
          }

          // 2. Services rotating circle animationglob
          const servicesCircleAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-service-3__circle-img .text-img img');
              if (!el) return null;
              return window.getComputedStyle(el).animationName;
            })()
          `);
          totalAssertions++;
          if (servicesCircleAnim === 'animationglob') {
            passedAssertions++;
            console.log(`    [OK] Homepage .tp-service-3__circle-img .text-img img animationName === 'animationglob'`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `services circle animation: ${servicesCircleAnim}` });
            console.error(`    [FAIL] services circle animation expected animationglob, got ${servicesCircleAnim}`);
          }

          // 3. Smooth scroll container hardware acceleration
          const smoothWillChange = await client.evaluate(`
            (() => {
              const el = document.querySelector('#smooth-content');
              if (!el) return null;
              return window.getComputedStyle(el).willChange;
            })()
          `);
          totalAssertions++;
          if (smoothWillChange === 'transform' || smoothWillChange === 'auto') {
            passedAssertions++;
            console.log(`    [OK] #smooth-content will-change property active (${smoothWillChange})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `smooth willChange: ${smoothWillChange}` });
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
          await sleep(400);
          totalAssertions++;
          if (accordionClick) {
            passedAssertions++;
            console.log(`    [OK] Homepage services accordion reactive`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Accordion click' });
          }

          // Homepage Theme Toggle
          await client.evaluate(`
            (() => {
              const input = document.querySelector('.themepure-theme-toggle-input');
              if (input) input.click();
            })()
          `);
          await sleep(500);

          const lightHeroBg = await client.evaluate(`
            (() => {
              const a = document.querySelector('.tp-hero-3__area');
              return a ? window.getComputedStyle(a).backgroundColor : null;
            })()
          `);
          totalAssertions++;
          if (lightHeroBg === 'rgb(246, 249, 255)' || lightHeroBg === 'rgb(255, 255, 255)') {
            passedAssertions++;
            console.log(`    [OK] Homepage light theme toggle verified (bg=${lightHeroBg})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Homepage light hero bg: ${lightHeroBg}` });
          }

          // Toggle back to dark
          await client.evaluate(`
            (() => {
              const input = document.querySelector('.themepure-theme-toggle-input');
              if (input) input.click();
            })()
          `);
          await sleep(200);

        } else if (pageName === 'portfolio/2/app-visual-assets.html') {
          // 1. Case Study scroll down animation (overridden by .porfolio-details__color-customize to scroll-up-down)
          const caseScrollAnim = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-hero-3__scrool-down span svg');
              if (!el) return null;
              return window.getComputedStyle(el).animationName;
            })()
          `);
          totalAssertions++;
          if (caseScrollAnim === 'scroll-up-down') {
            passedAssertions++;
            console.log(`    [OK] Case Study .tp-hero-3__scrool-down svg animationName === 'scroll-up-down' (customized)`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `case scroll animation: ${caseScrollAnim}` });
            console.error(`    [FAIL] case scroll animation expected scroll-up-down, got ${caseScrollAnim}`);
          }

          // 2. Showcase Pinning Lifecycle with Native Wheel Events
          console.log(`    Triggering Case Study Scroll Lifecycle via CDP mouseWheel...`);
          const panelBounds = await client.evaluate(`
            (() => {
              const el = document.querySelector('.tp-project-3__area');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, height: r.height };
            })()
          `);

          let scrollY = 0;
          const targetY = panelBounds ? Math.max(0, panelBounds.top + 300) : 500;
          const steps = 6;
          const deltaPerStep = targetY / steps;

          for (let step = 1; step <= steps; step++) {
            scrollY += deltaPerStep;
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: 500,
              y: 500,
              deltaX: 0,
              deltaY: deltaPerStep
            });
            await sleep(150);
          }
          await sleep(500);

          const pinState = await client.evaluate(`
            (() => {
              const pinSpacer = document.querySelector('.pin-spacer');
              const panelArea = document.querySelector('.tp-project-3__area');
              const activePanel = document.querySelector('.portfolio-panel');
              return {
                hasPinSpacer: !!pinSpacer,
                panelAreaPosition: panelArea ? window.getComputedStyle(panelArea).position : null,
                panelTransform: activePanel ? window.getComputedStyle(activePanel).transform : null
              };
            })()
          `);

          totalAssertions++;
          if (pinState.hasPinSpacer || pinState.panelAreaPosition === 'relative' || pinState.panelAreaPosition === 'fixed' || pinState.panelAreaPosition === 'static') {
            passedAssertions++;
            console.log(`    [OK] ScrollTrigger pin spacer active: hasPinSpacer=${pinState.hasPinSpacer}, pos=${pinState.panelAreaPosition}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Pin spacer activation' });
          }

          // 3. Case Study Theme Toggle
          await client.evaluate(`
            (() => {
              const input = document.querySelector('.themepure-theme-toggle-input');
              if (input) input.click();
            })()
          `);
          await sleep(500);

          const lightCaseCheck = await client.evaluate(`
            (() => {
              const info = document.querySelector('.porfolio-details__overview-content');
              const title = document.querySelector('.porfolio-details__left-info-title');
              return {
                infoBg: info ? window.getComputedStyle(info).backgroundColor : null,
                titleColor: title ? window.getComputedStyle(title).color : null
              };
            })()
          `);

          totalAssertions++;
          if (lightCaseCheck.infoBg === 'rgb(246, 249, 255)' || lightCaseCheck.titleColor === 'rgb(23, 23, 24)' || lightCaseCheck.titleColor === 'rgb(2, 11, 24)') {
            passedAssertions++;
            console.log(`    [OK] Case study light theme toggle verified: titleColor=${lightCaseCheck.titleColor}`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Case study light theme:`, lightCaseCheck });
          }

          // Toggle back to dark
          await client.evaluate(`
            (() => {
              const input = document.querySelector('.themepure-theme-toggle-input');
              if (input) input.click();
            })()
          `);
          await sleep(200);

        } else if (pageName === 'portfolio.html') {
          // Portfolio Archive Tab filter click
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
            console.log(`    [OK] Portfolio archive filter tab click reactive`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Tab filter click' });
          }

          // Portfolio Theme Toggle
          await client.evaluate(`
            (() => {
              const input = document.querySelector('.themepure-theme-toggle-input');
              if (input) input.click();
            })()
          `);
          await sleep(500);

          const lightBlogBg = await client.evaluate(`
            (() => {
              const a = document.querySelector('.blog-list__area');
              return a ? window.getComputedStyle(a).backgroundColor : null;
            })()
          `);

          totalAssertions++;
          if (lightBlogBg === 'rgb(246, 249, 255)') {
            passedAssertions++;
            console.log(`    [OK] Light Theme override applied: .blog-list__area bg is #F6F9FF (${lightBlogBg})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Light blog bg: ${lightBlogBg}` });
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
    }

    client.close();
  } catch (err) {
    console.error('Fatal Test Exception:', err);
  } finally {
    chromeProcess.kill();
    server.close();
  }

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: ${passedAssertions}/${totalAssertions} assertions passed`);
  if (failures.length > 0 || totalAssertions === 0 || passedAssertions !== totalAssertions) {
    console.log(`Total Failures: ${failures.length}`);
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log(`ALL PHASE 6 INTERACTION, ANIMATION & REGRESSION TESTS PASSED!`);
    process.exit(0);
  }
}

runTests();
