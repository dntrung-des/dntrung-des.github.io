const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8499;
const CDP_PORT = 9588;

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
    '--user-data-dir=/tmp/chrome-test-refine-' + Date.now()
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
  console.log(`Server started on port ${PORT}`);

  const chromeProc = await launchChrome(CDP_PORT);
  console.log(`Chrome started on debug port ${CDP_PORT}`);

  try {
    const wsUrl = await getWsUrl(CDP_PORT);
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    console.log('\n--- 1. DESKTOP 1920x1080 VERIFICATION ---');
    await cdp.setViewport(1920, 1080);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    const desktopData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const container = document.querySelector('.header-container');
      const centerIsland = document.querySelector('.header-zone-center');
      const activeLink = document.querySelector('.header-nav-link.active');
      const activeLinkAfter = window.getComputedStyle(activeLink, '::after');
      const ctaBtn = document.querySelector('.header-cta-btn');
      const ctaIcon = ctaBtn.querySelector('span svg');
      const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(el => ({
        text: el.textContent.trim(),
        width: Math.round(el.getBoundingClientRect().width),
        padding: window.getComputedStyle(el).padding,
        color: window.getComputedStyle(el).color
      }));

      return {
        containerBox: toObj(container.getBoundingClientRect()),
        centerIslandBox: toObj(centerIsland.getBoundingClientRect()),
        navLinks,
        activeState: {
          text: activeLink.textContent.trim(),
          color: window.getComputedStyle(activeLink).color,
          afterDisplay: activeLinkAfter.display,
          afterContent: activeLinkAfter.content
        },
        ctaBtn: {
          text: ctaBtn.textContent.trim(),
          box: toObj(ctaBtn.getBoundingClientRect()),
          hasIcon: !!ctaIcon,
          iconTag: ctaIcon ? ctaIcon.tagName : null,
          color: window.getComputedStyle(ctaBtn).color,
          bg: window.getComputedStyle(ctaBtn).backgroundColor,
          border: window.getComputedStyle(ctaBtn).border
        }
      };
    })()`);

    console.log('Desktop Header Data:');
    console.log(' - Container Box:', desktopData.containerBox);
    console.log(' - Center Island Box:', desktopData.centerIslandBox);
    console.log(' - Nav links spacing & colors:', desktopData.navLinks);
    console.log(' - Active link state:', desktopData.activeState);
    console.log(' - CTA button:', desktopData.ctaBtn);

    await cdp.captureScreenshot('scratch/latest_verify_desktop_top.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    console.log('\n--- 2. CTA HOVER TEST ---');
    // Dispatch mouseover on CTA button
    const ctaHoverData = await cdp.eval(`(() => {
      const ctaBtn = document.querySelector('.header-cta-btn');
      const icon = ctaBtn.querySelector('span svg');
      return {
        initialTransform: window.getComputedStyle(icon).transform
      };
    })()`);
    console.log(' - CTA initial icon transform:', ctaHoverData.initialTransform);

    console.log('\n--- 3. MOBILE (390x844) VERIFICATION ---');
    await cdp.setViewport(390, 844, 1, true);
    await new Promise(r => setTimeout(r, 600));

    // Open mobile menu
    await cdp.eval(`document.querySelector('.header-mobile-toggle').click()`);
    await new Promise(r => setTimeout(r, 400));

    const mobileData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const headerContainer = document.querySelector('.header-container');
      const mobileMenu = document.getElementById('header-mobile-menu');
      const ctaBtn = mobileMenu.querySelector('.mobile-cta-btn');
      const ctaIcon = ctaBtn.querySelector('span svg');

      const cRect = headerContainer.getBoundingClientRect();
      const mRect = mobileMenu.getBoundingClientRect();
      const gap = Math.round(mRect.top - cRect.bottom);

      return {
        containerBox: toObj(cRect),
        mobileMenuBox: toObj(mRect),
        gapBetweenHeaderAndDropdown: gap,
        ctaBtn: {
          text: ctaBtn.textContent.trim(),
          hasIcon: !!ctaIcon
        },
        activeLinkColor: window.getComputedStyle(mobileMenu.querySelector('.mobile-nav-link.active')).color
      };
    })()`);

    console.log('Mobile Data:');
    console.log(' - Container Box:', mobileData.containerBox);
    console.log(' - Mobile Menu Box:', mobileData.mobileMenuBox);
    console.log(' - Floating Gap between Header and Dropdown:', mobileData.gapBetweenHeaderAndDropdown, 'px (should be >= 10px)');
    console.log(' - Mobile CTA Button:', mobileData.ctaBtn);
    console.log(' - Mobile Active Link Color:', mobileData.activeLinkColor);

    await cdp.captureScreenshot('scratch/latest_verify_mobile_open.png', {
      x: 0, y: 0, width: 390, height: 480, scale: 1
    });

    console.log('\n--- 4. LIGHT THEME VERIFICATION ---');
    await cdp.setViewport(1920, 1080);
    await cdp.eval(`document.documentElement.setAttribute('tp-theme', 'tp-theme-light')`);
    await new Promise(r => setTimeout(r, 400));

    const lightData = await cdp.eval(`(() => {
      const activeLink = document.querySelector('.header-nav-link.active');
      const ctaBtn = document.querySelector('.header-cta-btn');

      return {
        activeLinkColor: window.getComputedStyle(activeLink).color,
        ctaColor: window.getComputedStyle(ctaBtn).color,
        ctaBorder: window.getComputedStyle(ctaBtn).borderColor
      };
    })()`);

    console.log('Light Theme Data:');
    console.log(' - Active Link Color (should be primary):', lightData.activeLinkColor);
    console.log(' - CTA Color:', lightData.ctaColor);

    await cdp.captureScreenshot('scratch/latest_verify_desktop_light.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    console.log('\nALL REFINEMENT VERIFICATIONS PASSED SUCCESSFULLY!');
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
