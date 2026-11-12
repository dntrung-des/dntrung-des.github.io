const http = require('http');
const { spawn } = require('child_process');

const PORT = 8092;
const CDP_PORT = 9224;

const PAGES = [
  'portfolio.html',
  'index.html',
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
  console.log('>>> Starting Headless Chrome for Phase 4 Verification...');
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
          // Global
          { sel: '.header-dynamic', name: 'Header Container' },
          { sel: '.tp-theme-toggle-main', name: 'Theme Toggle Pill' },
          { sel: '.change-theme-bottom', name: 'Theme Toggle Container' },
          { sel: '.tp-footer-3__widget', name: 'Footer Widget' },
          { sel: '.tp-copyright-3__social', name: 'Footer Social Wrap' },
        ];

        if (pageName === 'portfolio.html') {
          testElements.push(
            // Portfolio Tabs & Header
            { sel: '.blog-list__area', name: 'Portfolio Area' },
            { sel: '.blog-list__title-box', name: 'Portfolio Title Box' },
            { sel: '.blog-list__subtitle', name: 'Portfolio Subtitle' },
            { sel: '.blog-list__title', name: 'Portfolio Main Title' },
            { sel: '.blog-list__tab-btn', name: 'Portfolio Tab Btn Container' },
            { sel: '.blog-list__tab-btn ul li button.active', name: 'Active Tab Button' },
            { sel: '.blog-list__tab-btn ul li button span', name: 'Tab Button Span' },

            // Portfolio Grid & Cards
            { sel: '.tp-portfolio-item-wrapper', name: 'Portfolio Item Wrapper' },
            { sel: '.tp-portfolio-item', name: 'Portfolio Item Card' },
            { sel: '.tp-portfolio-thumb', name: 'Portfolio Card Thumb' },
            { sel: '.tp-portfolio-thumb-img', name: 'Portfolio Thumb Img' },
            { sel: '.blog-list__sm-category', name: 'Card Category Wrapper' },
            { sel: '.blog-list__sm-category span', name: 'Card Category Span' },
            { sel: '.tp-portfolio-content', name: 'Portfolio Card Content' },
            { sel: '.tp-portfolio-title', name: 'Portfolio Project Title' },
            { sel: '.tp-portfolio-meta', name: 'Portfolio Meta Container' },
            { sel: '.tp-portfolio-meta-count', name: 'Portfolio Meta Count' },
            { sel: '.tp-portfolio-meta-arrow', name: 'Portfolio Meta Arrow' },
            { sel: '.tp-portfolio-meta-hover', name: 'Portfolio Meta Hover' }
          );
        } else if (pageName === 'index.html') {
          testElements.push(
            // Homepage Hero, Services, Accordion, About, Skills, Project 3
            { sel: '.tp-hero-3__area', name: 'Hero Area' },
            { sel: '.tp-hero-title', name: 'Hero Headline' },
            { sel: '.services-panel-area', name: 'Services Panel Area' },
            { sel: '.tp-services-accordion', name: 'Services Accordion' },
            { sel: '.tp-about-inner', name: 'About Inner' },
            { sel: '.tp-skill-area', name: 'Skill Area' },
            { sel: '.tp-project-3__area', name: 'Homepage Project 3 Area' },
            { sel: '.tp-portfolio-item-3', name: 'Homepage Portfolio Item 3' }
          );
        } else if (pageName.includes('app-visual-assets')) {
          testElements.push(
            { sel: '.breadcrumb__area', name: 'Breadcrumb Area' },
            { sel: '.tp-btn-border-md', name: 'Border Medium Button' }
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
        await sleep(1000);

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

        if (pageName === 'portfolio.html') {
          // 5. Test Category Tab Switching on portfolio.html
          const tabClickResult = await client.evaluate(`
            (() => {
              const uxuiTab = document.querySelector('#Uxui-tab');
              if (!uxuiTab) return false;
              uxuiTab.click();
              return true;
            })()
          `);
          await sleep(300);

          const paneActive = await client.evaluate(`
            (() => {
              const pane = document.querySelector('#Uxui-tab-pane');
              return pane && pane.classList.contains('active') && pane.classList.contains('show');
            })()
          `);

          totalAssertions++;
          if (tabClickResult && paneActive) {
            passedAssertions++;
            console.log(`  [OK] Category tab filtering working (#Uxui-tab activated #Uxui-tab-pane)`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'UX/UI tab activation' });
            console.error(`  [FAIL] #Uxui-tab failed to activate #Uxui-tab-pane`);
          }

          // Switch to Development tab
          await client.evaluate(`
            (() => {
              const devTab = document.querySelector('#Development-tab');
              if (devTab) devTab.click();
            })()
          `);
          await sleep(300);

          const devActive = await client.evaluate(`
            (() => {
              const pane = document.querySelector('#Development-tab-pane');
              return pane && pane.classList.contains('active');
            })()
          `);

          totalAssertions++;
          if (devActive) {
            passedAssertions++;
            console.log(`  [OK] Development category tab activated cleanly`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: 'Development tab activation' });
            console.error(`  [FAIL] Development tab activation failed`);
          }

          // Restore All tab
          await client.evaluate(`
            (() => {
              const allTab = document.querySelector('#All-tab');
              if (allTab) allTab.click();
            })()
          `);
          await sleep(200);

          // 6. Test Theme Toggle on portfolio.html
          await client.evaluate(`
            (() => {
              const t = document.querySelector('.tp-theme-toggle-main');
              if (t) t.click();
            })()
          `);
          await sleep(400);

          const lightBlogBg = await client.evaluate(`
            (() => {
              const a = document.querySelector('.blog-list__area');
              return a ? window.getComputedStyle(a).backgroundColor : null;
            })()
          `);

          totalAssertions++;
          if (lightBlogBg === 'rgb(246, 249, 255)') { // #F6F9FF
            passedAssertions++;
            console.log(`  [OK] Light Theme override applied: .blog-list__area bg is #F6F9FF (${lightBlogBg})`);
          } else {
            failures.push({ page: pageName, viewport: vp.name, check: `Light blog bg: ${lightBlogBg}` });
            console.error(`  [FAIL] Light theme blog-list bg expected rgb(246, 249, 255), got ${lightBlogBg}`);
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
    console.log(`ALL PORTFOLIO & CROSS-PAGE PARITY TESTS PASSED WITH 0 REGRESSIONS!`);
    process.exit(0);
  }
}

runTests();
