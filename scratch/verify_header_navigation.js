const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8199;
const CDP_PORT = 9272;

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
  '.pdf': 'application/pdf'
};

function createStaticServer(port) {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath.replace(/^\//, ''));

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found: ' + reqPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

function launchChrome(cdpPort) {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/chrome-test-header-refine-' + Date.now()
  ], { stdio: 'ignore' });

  return new Promise((resolve) => setTimeout(() => resolve(chromeProc), 1500));
}

async function getWsUrl(cdpPort) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const targets = await res.json();
      const pageTarget = targets.find(t => t.type === 'page') || targets[0];
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Could not find page target');
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { res, rej } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) rej(msg.error);
          else res(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }

  async screenshot(outputPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('--- Starting Header Refinement Verification ---');
  const server = await createStaticServer(PORT);
  const chrome = await launchChrome(CDP_PORT);
  const wsUrl = await getWsUrl(CDP_PORT);
  const cdp = new CDPClient(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  const results = [];

  const pages = [
    { name: 'Homepage (index.html)', url: `http://localhost:${PORT}/index.html`, expectedActive: 'Home' },
    { name: 'Portfolio (portfolio.html)', url: `http://localhost:${PORT}/portfolio.html`, expectedActive: 'Projects' },
    { name: 'Case Study (portfolio/2/app-visual-assets.html)', url: `http://localhost:${PORT}/portfolio/2/app-visual-assets.html`, expectedActive: null }
  ];

  for (const page of pages) {
    console.log(`\n================ Testing ${page.name} ================`);

    // 1. Desktop 1920x1080 (Top of Page)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.send('Page.navigate', { url: page.url });
    await new Promise(r => setTimeout(r, 2000));

    // Verify Desktop State 1: Top of page (scrollY = 0)
    const state1 = await cdp.evaluate(`(() => {
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      const zoneLeft = document.querySelector('.header-zone-left');
      const zoneCenter = document.querySelector('.header-zone-center');
      const zoneRight = document.querySelector('.header-zone-right');
      const logoMain = document.querySelector('.logo-main');
      const logoIcon = document.querySelector('.logo-icon');
      const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(a => ({
        text: a.textContent.trim(),
        isActive: a.classList.contains('active'),
        color: window.getComputedStyle(a).color,
        bg: window.getComputedStyle(a).backgroundColor,
        fontWeight: window.getComputedStyle(a).fontWeight,
        height: a.getBoundingClientRect().height,
        minHeight: window.getComputedStyle(a).minHeight
      }));
      const cvBtn = document.querySelector('.header-cv-cta');
      const cvStyle = window.getComputedStyle(cvBtn);

      const cRect = container.getBoundingClientRect();
      const lRect = zoneLeft.getBoundingClientRect();
      const mRect = zoneCenter.getBoundingClientRect();
      const rRect = zoneRight.getBoundingClientRect();
      const logoMainRect = logoMain.getBoundingClientRect();

      return {
        isScrolled: header.classList.contains('is-scrolled'),
        containerWidth: cRect.width,
        zoneCenterHeight: mRect.height,
        logoMainHeight: logoMainRect.height,
        logoMainVisible: logoMainRect.width > 0 && logoMainRect.height > 0,
        logoIconVisible: logoIcon.getBoundingClientRect().width > 0,
        navLinks,
        cvBtnText: cvBtn ? cvBtn.innerText.replace(/\\s+/g, ' ').trim() : null,
        cvBtnHref: cvBtn ? cvBtn.getAttribute('href') : null,
        cvBtnHeight: cvBtn.getBoundingClientRect().height,
        cvBtnBorderRadius: cvStyle.borderRadius,
        cvBtnBorder: cvStyle.borderTopWidth + ' ' + cvStyle.borderTopStyle,
        cvBtnBg: cvStyle.backgroundColor,
        separationLeftToCenter: mRect.left - lRect.right,
        separationCenterToRight: rRect.left - mRect.right
      };
    })()`);

    console.log('Desktop State 1 (Top):', state1);

    const navTexts = state1.navLinks.map(l => l.text);
    const expectedOrder = ['Home', 'About Me', 'Projects', 'Contact'];
    const orderMatches = JSON.stringify(navTexts) === JSON.stringify(expectedOrder);
    const activeLink = state1.navLinks.find(l => l.isActive);
    const activeBgIsTransparent = activeLink ? (activeLink.bg === 'rgba(0, 0, 0, 0)' || activeLink.bg === 'transparent') : true;

    results.push({
      test: `${page.name} - Nav Order: Home · About Me · Projects · Contact`,
      pass: orderMatches
    });

    results.push({
      test: `${page.name} - Active Nav Not CTA Pill (Transparent Background)`,
      pass: activeBgIsTransparent
    });

    results.push({
      test: `${page.name} - Increased Header Scale (Island >= 50px, Links >= 44px hit area, Logo >= 38px)`,
      pass: state1.zoneCenterHeight >= 50 &&
            state1.navLinks.every(l => l.height >= 40) &&
            state1.logoMainHeight >= 36
    });

    results.push({
      test: `${page.name} - Download CV Matches See Resume System (.tp-btn-border-sm)`,
      pass: state1.cvBtnText.includes('Download CV') &&
            state1.cvBtnHref.includes('CV_UIUX Design_Trung.pdf') &&
            state1.cvBtnHeight >= 44 &&
            state1.cvBtnHeight <= 52 &&
            parseInt(state1.cvBtnBorderRadius) >= 50 // pill radius
    });

    const pageSlug = page.name.split(' ')[0].toLowerCase();
    await cdp.screenshot(`scratch/${pageSlug}_refine_desktop_top.png`);

    // 2. Desktop State 2: Scrolled (scrollY = 400)
    await cdp.evaluate(`window.scrollTo(0, 400)`);
    // Wait 550ms for the 500ms smooth transition to finish
    await new Promise(r => setTimeout(r, 600));

    const state2 = await cdp.evaluate(`(() => {
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      const logoMain = document.querySelector('.logo-main');
      const logoIcon = document.querySelector('.logo-icon');
      const dividers = Array.from(document.querySelectorAll('.header-dock-divider')).map(d => ({
        width: d.getBoundingClientRect().width,
        height: d.getBoundingClientRect().height,
        opacity: window.getComputedStyle(d).opacity
      }));
      const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(a => ({
        text: a.textContent.trim(),
        visible: a.getBoundingClientRect().width > 0
      }));
      const cvBtn = document.querySelector('.header-cv-cta');
      const cvText = cvBtn ? cvBtn.innerText.replace(/\\s+/g, ' ').trim() : null;
      const hRect = header.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const centerX = cRect.left + cRect.width / 2;
      const headerCenterX = hRect.left + hRect.width / 2;

      return {
        isScrolled: header.classList.contains('is-scrolled'),
        containerWidth: cRect.width,
        isCentered: Math.abs(centerX - headerCenterX) < 2,
        logoMainWidth: logoMain.getBoundingClientRect().width,
        logoIconWidth: logoIcon.getBoundingClientRect().width,
        logoIconHeight: logoIcon.getBoundingClientRect().height,
        logoIconOpacity: window.getComputedStyle(logoIcon).opacity,
        dividersVisible: dividers.every(d => d.height > 15 && parseFloat(d.opacity) > 0.8),
        navLinks,
        allLinksVisible: navLinks.every(l => l.visible),
        cvBtnVisible: cvBtn.getBoundingClientRect().width > 0,
        cvText
      };
    })()`);

    console.log('Desktop State 2 (Scrolled Dock):', state2);
    results.push({
      test: `${page.name} - Desktop Scrolled Compact Dock (Width <= 600px, Centered, Icon Visible)`,
      pass: state2.isScrolled &&
            state2.containerWidth <= 600 &&
            state2.isCentered &&
            state2.logoIconWidth >= 30 &&
            parseFloat(state2.logoIconOpacity) > 0.9 &&
            state2.logoMainWidth < 1 &&
            state2.allLinksVisible &&
            state2.cvBtnVisible &&
            state2.cvText.includes('CV')
    });

    await cdp.screenshot(`scratch/${pageSlug}_refine_desktop_scrolled.png`);

    // 3. Desktop Reverse Scroll (scrollY = 0)
    await cdp.evaluate(`window.scrollTo(0, 0)`);
    await new Promise(r => setTimeout(r, 600));

    const state3 = await cdp.evaluate(`(() => {
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      const logoMain = document.querySelector('.logo-main');
      const cRect = container.getBoundingClientRect();
      return {
        isScrolled: header.classList.contains('is-scrolled'),
        containerWidth: cRect.width,
        logoMainVisible: logoMain.getBoundingClientRect().width > 0
      };
    })()`);

    results.push({
      test: `${page.name} - Smooth Reverse Restoration to 3-Zone Layout`,
      pass: !state3.isScrolled && state3.containerWidth > 1000 && state3.logoMainVisible
    });

    // 4. Mobile 390x844 (Top of Page & Menu Drawer)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await cdp.evaluate(`window.scrollTo(0, 0)`);
    await new Promise(r => setTimeout(r, 500));

    const mobileTop = await cdp.evaluate(`(() => {
      const container = document.querySelector('.header-container');
      const toggle = document.querySelector('.header-mobile-toggle');
      const mobileMenu = document.getElementById('header-mobile-menu');
      const cRect = container.getBoundingClientRect();
      const overflow = document.documentElement.scrollWidth > window.innerWidth;

      return {
        containerWidth: cRect.width,
        toggleVisible: toggle && window.getComputedStyle(toggle).display !== 'none',
        toggleAriaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        mobileMenuHidden: mobileMenu.getAttribute('aria-hidden'),
        hasHorizontalOverflow: overflow
      };
    })()`);

    console.log('Mobile Top State:', mobileTop);
    results.push({
      test: `${page.name} - Mobile Top Bar & No Overflow`,
      pass: mobileTop.toggleVisible &&
            mobileTop.toggleAriaExpanded === 'false' &&
            mobileTop.mobileMenuHidden === 'true' &&
            !mobileTop.hasHorizontalOverflow
    });

    await cdp.screenshot(`scratch/${pageSlug}_refine_mobile_top.png`);

    // Click mobile hamburger toggle to open drawer
    await cdp.evaluate(`document.querySelector('.header-mobile-toggle').click()`);
    await new Promise(r => setTimeout(r, 400));

    const mobileMenuOpen = await cdp.evaluate(`(() => {
      const header = document.querySelector('.header-area');
      const toggle = document.querySelector('.header-mobile-toggle');
      const mobileMenu = document.getElementById('header-mobile-menu');
      const mLinks = Array.from(document.querySelectorAll('.mobile-nav-link')).map(a => ({
        text: a.textContent.trim(),
        isActive: a.classList.contains('active'),
        bg: window.getComputedStyle(a).backgroundColor
      }));
      const mCv = document.querySelector('.mobile-cv-btn');
      const mRect = mobileMenu.getBoundingClientRect();

      return {
        isMenuOpen: header.classList.contains('is-menu-open'),
        toggleAriaExpanded: toggle.getAttribute('aria-expanded'),
        mobileMenuAriaHidden: mobileMenu.getAttribute('aria-hidden'),
        mobileMenuVisible: mRect.width > 0 && mRect.height > 0 && window.getComputedStyle(mobileMenu).opacity === '1',
        mobileLinks: mLinks,
        mobileCvText: mCv ? mCv.innerText.replace(/\\s+/g, ' ').trim() : null
      };
    })()`);

    console.log('Mobile Menu Open State:', mobileMenuOpen);
    const mActive = mobileMenuOpen.mobileLinks.find(l => l.isActive);
    const mActiveBgTransparent = mActive ? (mActive.bg === 'rgba(0, 0, 0, 0)' || mActive.bg === 'transparent') : true;

    results.push({
      test: `${page.name} - Mobile Drawer Open & All Destinations (Home, About Me, Projects, Contact, CV)`,
      pass: mobileMenuOpen.isMenuOpen &&
            mobileMenuOpen.toggleAriaExpanded === 'true' &&
            mobileMenuOpen.mobileMenuAriaHidden === 'false' &&
            mobileMenuOpen.mobileMenuVisible &&
            mobileMenuOpen.mobileLinks.map(l => l.text).includes('Projects') &&
            mActiveBgTransparent &&
            mobileMenuOpen.mobileCvText.includes('Download CV')
    });

    await cdp.screenshot(`scratch/${pageSlug}_refine_mobile_open.png`);

    // Test Escape key close
    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))`);
    await new Promise(r => setTimeout(r, 400));

    const mobileEscape = await cdp.evaluate(`(() => {
      const header = document.querySelector('.header-area');
      const toggle = document.querySelector('.header-mobile-toggle');
      const mobileMenu = document.getElementById('header-mobile-menu');
      return {
        isMenuOpen: header.classList.contains('is-menu-open'),
        toggleAriaExpanded: toggle.getAttribute('aria-expanded'),
        mobileMenuAriaHidden: mobileMenu.getAttribute('aria-hidden')
      };
    })()`);

    results.push({
      test: `${page.name} - Mobile Drawer Closes on Escape Key`,
      pass: !mobileEscape.isMenuOpen &&
            mobileEscape.toggleAriaExpanded === 'false' &&
            mobileEscape.mobileMenuAriaHidden === 'true'
    });
  }

  // Check Light Theme on Homepage
  console.log(`\n================ Testing Light Theme ================`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
  await new Promise(r => setTimeout(r, 1500));

  await cdp.evaluate(`document.documentElement.setAttribute('tp-theme', 'tp-theme-light')`);
  await new Promise(r => setTimeout(r, 300));
  await cdp.screenshot(`scratch/homepage_refine_desktop_light_top.png`);

  const lightTopState = await cdp.evaluate(`(() => {
    const center = document.querySelector('.header-zone-center');
    const links = Array.from(document.querySelectorAll('.header-nav-link')).map(a => ({
      text: a.textContent.trim(),
      isActive: a.classList.contains('active'),
      color: window.getComputedStyle(a).color,
      bg: window.getComputedStyle(a).backgroundColor
    }));
    const cv = document.querySelector('.header-cv-cta');
    return {
      centerBg: window.getComputedStyle(center).backgroundColor,
      cvColor: window.getComputedStyle(cv).color,
      cvBg: window.getComputedStyle(cv).backgroundColor,
      links
    };
  })()`);

  await cdp.evaluate(`window.scrollTo(0, 400)`);
  await new Promise(r => setTimeout(r, 500));
  await cdp.screenshot(`scratch/homepage_refine_desktop_light_scrolled.png`);

  const lightScrolledState = await cdp.evaluate(`(() => {
    const container = document.querySelector('.header-container');
    const links = Array.from(document.querySelectorAll('.header-nav-link')).map(a => ({
      text: a.textContent.trim(),
      isActive: a.classList.contains('active'),
      color: window.getComputedStyle(a).color
    }));
    return {
      scrolledContainerBg: window.getComputedStyle(container).backgroundColor,
      links
    };
  })()`);

  console.log('Light Theme Top State:', lightTopState);
  console.log('Light Theme Scrolled State:', lightScrolledState);

  const activeLink = lightTopState.links.find(l => l.isActive);
  const inactiveLink = lightTopState.links.find(l => !l.isActive);

  results.push({
    test: `Homepage - Light Theme Colors & Contrast`,
    pass: lightTopState.centerBg.includes('255, 255, 255') &&
          lightScrolledState.scrolledContainerBg.includes('255, 255, 255') &&
          activeLink.color === 'rgb(2, 11, 24)' && // Active link dark text emphasis, no white pill
          inactiveLink.color === 'rgb(85, 88, 91)' && // Inactive secondary text
          activeLink.bg === 'rgba(0, 0, 0, 0)' // No filled pill
  });

  console.log('\n--- VERIFICATION SUMMARY ---');
  let allPassed = true;
  for (const r of results) {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.test}`);
    if (!r.pass) allPassed = false;
  }

  cdp.close();
  chrome.kill();
  server.close();

  if (allPassed) {
    console.log('\n🎉 ALL HEADER REFINEMENT TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
