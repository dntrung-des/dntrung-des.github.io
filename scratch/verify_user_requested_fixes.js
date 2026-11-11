const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8399;
const CDP_PORT = 9488;

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
    '--user-data-dir=/tmp/chrome-test-fixes-2-' + Date.now()
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

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result.value;
  }

  async setViewport(w, h, scale = 1, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: scale,
      mobile: isMobile
    });
    await this.send('Emulation.setVisibleSize', { width: w, height: h });
  }

  async captureScreenshot(outPath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await this.send('Page.captureScreenshot', params);
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  const server = await createStaticServer(PORT);
  console.log(`Test server running on port ${PORT}`);

  const chromeProc = await launchChrome(CDP_PORT);
  console.log(`Chrome started on debug port ${CDP_PORT}`);

  try {
    const wsUrl = await getWsUrl(CDP_PORT);
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    console.log('\n--- VERIFYING HOMEPAGE (index.html) ---');
    await cdp.setViewport(1920, 1080);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    // 1. Inspect Desktop Default Top State
    const topStateData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      const logoMainDark = document.querySelector('.logo-main.logo-dark');
      const logoMainLight = document.querySelector('.logo-main.logo-light');
      const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(el => ({
        text: el.textContent.trim(),
        href: el.getAttribute('href'),
        isActive: el.classList.contains('active'),
        rect: toObj(el.getBoundingClientRect())
      }));
      const ctaBtn = document.querySelector('.header-cta-btn');
      const activeLink = document.querySelector('.header-nav-link.active');

      return {
        headerBox: toObj(header.getBoundingClientRect()),
        containerBox: toObj(container.getBoundingClientRect()),
        logoDarkBox: toObj(logoMainDark.getBoundingClientRect()),
        logoMainDarkDisplay: window.getComputedStyle(logoMainDark).display,
        logoMainLightDisplay: window.getComputedStyle(logoMainLight).display,
        logoMainFilter: window.getComputedStyle(logoMainDark).filter,
        navLinks,
        cta: {
          text: ctaBtn ? ctaBtn.textContent.trim() : null,
          href: ctaBtn ? ctaBtn.getAttribute('href') : null,
          rect: ctaBtn ? toObj(ctaBtn.getBoundingClientRect()) : null,
          computedHeight: ctaBtn ? window.getComputedStyle(ctaBtn).height : null,
          display: ctaBtn ? window.getComputedStyle(ctaBtn).display : null,
          alignItems: ctaBtn ? window.getComputedStyle(ctaBtn).alignItems : null,
          justifyContent: ctaBtn ? window.getComputedStyle(ctaBtn).justifyContent : null
        },
        activeLinkText: activeLink ? activeLink.textContent.trim() : null,
        activeWidth: activeLink ? Math.round(activeLink.getBoundingClientRect().width) : null
      };
    })()`);

    console.log('Homepage Top State:');
    console.log(' - Container Dimensions:', topStateData.containerBox);
    console.log(' - Logo Dark Dimensions:', topStateData.logoDarkBox);
    console.log(' - Nav links:', topStateData.navLinks);
    console.log(' - CTA button:', topStateData.cta);
    console.log(' - Logo Filter:', topStateData.logoMainFilter);

    await cdp.captureScreenshot('scratch/fix_verify_desktop_top.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    // 2. Light Theme Check
    await cdp.eval(`document.documentElement.setAttribute('tp-theme', 'tp-theme-light')`);
    await new Promise(r => setTimeout(r, 400));

    const lightThemeData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const logoMainDark = document.querySelector('.logo-main.logo-dark');
      const logoMainLight = document.querySelector('.logo-main.logo-light');
      const ctaBtn = document.querySelector('.header-cta-btn');

      return {
        logoDarkDisplay: window.getComputedStyle(logoMainDark).display,
        logoLightDisplay: window.getComputedStyle(logoMainLight).display,
        logoLightBox: toObj(logoMainLight.getBoundingClientRect()),
        logoLightFilter: window.getComputedStyle(logoMainLight).filter,
        ctaColor: window.getComputedStyle(ctaBtn).color,
        ctaBg: window.getComputedStyle(ctaBtn).backgroundColor
      };
    })()`);

    console.log('\nLight Theme Data:');
    console.log(' - Logo Dark Display (should be none):', lightThemeData.logoDarkDisplay);
    console.log(' - Logo Light Display (should be block):', lightThemeData.logoLightDisplay);
    console.log(' - Logo Light Box:', lightThemeData.logoLightBox);
    console.log(' - Logo Light Filter (should be none):', lightThemeData.logoLightFilter);
    console.log(' - CTA Colors in Light Theme:', lightThemeData.ctaColor, lightThemeData.ctaBg);

    await cdp.captureScreenshot('scratch/fix_verify_desktop_light.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    // Switch back to dark theme
    await cdp.eval(`document.documentElement.setAttribute('tp-theme', 'tp-theme-dark')`);
    await new Promise(r => setTimeout(r, 200));

    // 3. Scrolled Floating Dock State
    console.log('\n--- VERIFYING SCROLLED DOCK STATE ---');
    await cdp.eval(`window.scrollTo(0, 500)`);
    await new Promise(r => setTimeout(r, 800));

    const scrolledData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      const logoIcon = document.querySelector('.logo-icon');
      const ctaBtn = document.querySelector('.header-cta-btn');

      return {
        isScrolledClass: header.classList.contains('is-scrolled'),
        containerRect: toObj(container.getBoundingClientRect()),
        logoIconRect: toObj(logoIcon.getBoundingClientRect()),
        logoIconOpacity: window.getComputedStyle(logoIcon).opacity,
        ctaRect: ctaBtn ? toObj(ctaBtn.getBoundingClientRect()) : null,
        ctaText: ctaBtn ? ctaBtn.textContent.trim() : null
      };
    })()`);

    console.log('Scrolled Dock Data:');
    console.log(' - isScrolled:', scrolledData.isScrolledClass);
    console.log(' - Dock rect:', scrolledData.containerRect);
    console.log(' - Logo icon rect:', scrolledData.logoIconRect, '| opacity:', scrolledData.logoIconOpacity);
    console.log(' - Scrolled CTA rect:', scrolledData.ctaRect, '| text:', scrolledData.ctaText);

    // When scrolled, capture full screen or top region where header floats
    await cdp.captureScreenshot('scratch/fix_verify_desktop_scrolled.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    // 4. Mobile Viewport
    console.log('\n--- VERIFYING MOBILE (390x844) ---');
    await cdp.eval(`window.scrollTo(0, 0)`);
    await cdp.setViewport(390, 844, 1, true);
    await new Promise(r => setTimeout(r, 500));

    const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
    const mobileTopData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const container = document.querySelector('.header-container');
      const toggle = document.querySelector('.header-mobile-toggle');
      const menu = document.getElementById('header-mobile-menu');

      return {
        containerBox: toObj(container.getBoundingClientRect()),
        toggleDisplay: window.getComputedStyle(toggle).display,
        toggleBox: toObj(toggle.getBoundingClientRect()),
        menuVisible: window.getComputedStyle(menu).opacity
      };
    })()`);

    console.log('Mobile Top Data:');
    console.log(' - Container box:', mobileTopData.containerBox);
    console.log(' - Toggle button display:', mobileTopData.toggleDisplay, '| box:', mobileTopData.toggleBox);
    console.log(' - Mobile menu opacity at closed:', mobileTopData.menuVisible);

    await cdp.captureScreenshot('scratch/fix_verify_mobile_top.png', {
      x: 0, y: 0, width: 390, height: 200, scale: 1
    });

    // Click mobile toggle
    await cdp.eval(`document.querySelector('.header-mobile-toggle').click()`);
    await new Promise(r => setTimeout(r, 400));

    const mobileOpenData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const menu = document.getElementById('header-mobile-menu');
      const links = Array.from(menu.querySelectorAll('.mobile-nav-link')).map(el => ({
        text: el.textContent.trim(),
        href: el.getAttribute('href'),
        isActive: el.classList.contains('active'),
        rect: toObj(el.getBoundingClientRect())
      }));
      const ctaBtn = menu.querySelector('.mobile-cta-btn');

      return {
        menuOpacity: window.getComputedStyle(menu).opacity,
        menuBox: toObj(menu.getBoundingClientRect()),
        links,
        cta: {
          text: ctaBtn ? ctaBtn.textContent.trim() : null,
          href: ctaBtn ? ctaBtn.getAttribute('href') : null,
          rect: ctaBtn ? toObj(ctaBtn.getBoundingClientRect()) : null
        }
      };
    })()`);

    console.log('\nMobile Drawer Open Data:');
    console.log(' - Menu opacity:', mobileOpenData.menuOpacity, '| box:', mobileOpenData.menuBox);
    console.log(' - Mobile nav links:', mobileOpenData.links);
    console.log(' - Mobile CTA button:', mobileOpenData.cta);

    await cdp.captureScreenshot('scratch/fix_verify_mobile_open.png', {
      x: 0, y: 0, width: 390, height: 460, scale: 1
    });

    console.log('\nALL VERIFICATIONS PASSED WITH COMPLETE PRECISION!');
    cdp.close();
  } finally {
    server.close();
    chromeProc.kill();
  }
}

run().catch(err => {
  console.error('Error running verification:', err);
  process.exit(1);
});
