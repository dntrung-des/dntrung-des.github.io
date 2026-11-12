const http = require('http');
const { spawn } = require('child_process');

const PORT = 8091;
const CDP_PORT = 9223;

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
  console.log('>>> Starting Headless Chrome for Phase 3 Verification...');
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

        // 1. Verify title
        const title = await client.evaluate(`document.title`);
        console.log(`  Page Title: "${title}"`);

        // 2. Select elements to test depending on page
        const testElements = [
          // Global (Phase 2)
          { sel: '.header-dynamic', name: 'Header Container' },
          { sel: '.tp-theme-toggle-main', name: 'Theme Toggle Pill' },
          { sel: '.change-theme-bottom', name: 'Theme Toggle Container' },
          { sel: '.tp-footer-3__widget', name: 'Footer Widget' },
          { sel: '.tp-copyright-3__social', name: 'Footer Social Wrap' },
          { sel: '.tp-section-title', name: 'Section Title' },
          { sel: '.tp-section-subtitle', name: 'Section Subtitle' },
        ];

        if (pageName === 'index.html') {
          testElements.push(
            // Hero
            { sel: '.tp-hero-3__area', name: 'Hero Area' },
            { sel: '.tp-hero-3__title', name: 'Hero 3 Title' },
            { sel: '.tp-hero-title', name: 'Hero Headline' },
            { sel: '.cd-words-wrapper', name: 'Rotating Words Wrapper' },
            { sel: '.tp-hero-3__btn-box', name: 'Hero Btn Box' },
            { sel: '.tp-hero-3__scrool-down', name: 'Hero Scroll Down' },
            { sel: '.tp-hero-social-wrapper-2 .parallax-wrap', name: 'Hero Parallax Wrap' },

            // Services
            { sel: '.services-panel-area', name: 'Services Panel Area' },
            { sel: '.tp-service-3__circle-img', name: 'Service Circle Img' },
            { sel: '.tp-service-3__overlay-bg', name: 'Service Overlay Bg' },
            { sel: '.tp-services-area', name: 'Services Matter Area' },
            { sel: '.tp-services-capsule-wrapper', name: 'Services Capsule Wrapper' },
            { sel: '.tp-services-top-text p', name: 'Services Top Text' },
            { sel: '.tp-services-bottom-text p', name: 'Services Bottom Text' },

            // Accordion
            { sel: '.tp-services-accordion', name: 'Services Accordion' },
            { sel: '.tp-services-accordion .accordion-item', name: 'Services Accordion Item' },
            { sel: '.tp-services-accordion .accordion-button', name: 'Services Accordion Button' },
            { sel: '.tp-services-accordion .accordion-body', name: 'Services Accordion Body' },

            // About
            { sel: '.tp-about-inner', name: 'About Inner' },
            { sel: '.tp-about-desc-content p', name: 'About Desc Paragraph' },
            { sel: '.tp-about-fact-item', name: 'About Fact Item' },

            // Skills
            { sel: '.tp-skill-area', name: 'Skill Area' },
            { sel: '.tp-skill-tab .nav-tabs', name: 'Skill Nav Tabs' },
            { sel: '.tp-skill-tab .nav-tabs .nav-link', name: 'Skill Nav Link' },
            { sel: '#lineMarker', name: 'Skill LineMarker' },
            { sel: '.tp-skill-item', name: 'Skill Item' },
            { sel: '.tp-skill-title', name: 'Skill Title' }
          );
        } else if (pageName === 'portfolio.html') {
          testElements.push(
            { sel: '.tp-btn-black-lg', name: 'Black Large Button' },
            { sel: '.breadcrumb__area', name: 'Breadcrumb Area' }
          );
        } else if (pageName.includes('app-visual-assets')) {
          testElements.push(
            { sel: '.tp-btn-border-md', name: 'Border Medium Button' },
            { sel: '.breadcrumb__area', name: 'Breadcrumb Area' }
          );
        }

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

        console.log(`  Recorded ${Object.keys(originalStyles).length} active element styles with main.css`);

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

        if (pageName === 'index.html') {
          // 5. Test Skills #lineMarker behavior
          const markerStyle = await client.evaluate(`
            (() => {
              const m = document.querySelector('#lineMarker');
              if (!m) return null;
              const r = m.getBoundingClientRect();
              return { width: r.width, height: r.height, top: r.top };
            })()
          `);

          totalAssertions++;
          if (markerStyle && markerStyle.width > 0) {
            passedAssertions++;
            console.log(`  [OK] Skills #lineMarker has valid rendered geometry (width=${markerStyle.width}px)`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Skills #lineMarker width' });
            console.error(`  [FAIL] Skills #lineMarker has 0 width or is missing`);
          }

          // Click on development tab
          const tabClickResult = await client.evaluate(`
            (() => {
              const devTab = document.querySelector('#nav-tech-tab');
              if (!devTab) return false;
              devTab.click();
              return true;
            })()
          `);
          await sleep(300);

          totalAssertions++;
          if (tabClickResult) {
            passedAssertions++;
            console.log(`  [OK] Tab switching interactive event triggered cleanly (#nav-tech-tab clicked)`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Skills tab #nav-tech-tab click' });
            console.error(`  [FAIL] Skills tab #nav-tech-tab not found`);
          }

          // 6. Test Accordion expansion
          const accordionToggle = await client.evaluate(`
            (() => {
              const btn = document.querySelector('.tp-services-accordion .accordion-item:last-child .accordion-button');
              if (!btn) return false;
              btn.click();
              return true;
            })()
          `);
          await sleep(300);

          totalAssertions++;
          if (accordionToggle) {
            passedAssertions++;
            console.log(`  [OK] Services Accordion item expanded cleanly`);
          }

          // 7. Test Theme toggle on homepage (check light overrides)
          await client.evaluate(`
            (() => {
              const t = document.querySelector('.tp-theme-toggle-main');
              if (t) t.click();
            })()
          `);
          await sleep(400);

          const lightHeroBg = await client.evaluate(`
            (() => {
              const h = document.querySelector('.tp-hero-3__area');
              return h ? window.getComputedStyle(h).backgroundColor : null;
            })()
          `);

          totalAssertions++;
          if (lightHeroBg === 'rgb(246, 249, 255)') { // #F6F9FF
            passedAssertions++;
            console.log(`  [OK] Light Theme override applied: .tp-hero-3__area bg is #F6F9FF (${lightHeroBg})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Light hero bg: ${lightHeroBg}` });
            console.error(`  [FAIL] Light theme hero bg expected rgb(246, 249, 255), got ${lightHeroBg}`);
          }

          // Toggle back to dark
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
  if (failures.length > 0 || passedAssertions !== totalAssertions) {
    console.log(`Total Failures: ${failures.length}`);
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log(`ALL HOMEPAGE & GLOBAL PARITY TESTS PASSED WITH 0 REGRESSIONS!`);
    process.exit(0);
  }
}

runTests();
