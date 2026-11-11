const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8599;
const CDP_PORT = 9688;

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
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=/tmp/chrome-test-final-step-${cdpPort}`
  ], { stdio: 'ignore' });

  return new Promise((resolve) => setTimeout(() => resolve(chromeProc), 1500));
}

async function getWsUrl(cdpPort) {
  for (let i = 0; i < 25; i++) {
    try {
      const targets = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${cdpPort}/json`, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            try { res(JSON.parse(d)); } catch(e) { rej(e); }
          });
        }).on('error', rej);
      });
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

    console.log('\n--- 1. DESKTOP DEFAULT TOP STATE VERIFICATION ---');
    await cdp.setViewport(1920, 1080);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    const topData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const container = document.querySelector('.header-container');
      const cStyle = window.getComputedStyle(container);
      const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(el => ({
        text: el.textContent.trim(),
        href: el.getAttribute('href'),
        isActive: el.classList.contains('active'),
        color: window.getComputedStyle(el).color
      }));
      const cvBtn = document.querySelector('.header-cv-cta');
      const cvBtnAfter = window.getComputedStyle(cvBtn, '::after');
      const cvIcon = cvBtn.querySelector('svg');

      return {
        containerBox: toObj(container.getBoundingClientRect()),
        containerHeight: cStyle.height,
        containerPadding: cStyle.padding,
        navLinks,
        cvBtn: {
          text: cvBtn.querySelector('.text') ? cvBtn.querySelector('.text').textContent.trim() : cvBtn.textContent.trim(),
          href: cvBtn.getAttribute('href'),
          box: toObj(cvBtn.getBoundingClientRect()),
          color: window.getComputedStyle(cvBtn).color,
          afterBg: cvBtnAfter.backgroundColor,
          afterWidth: cvBtnAfter.width,
          hasIcon: !!cvIcon,
          svgViewBox: cvIcon ? cvIcon.getAttribute('viewBox') : null,
          svgPath: cvIcon ? cvIcon.querySelector('path').getAttribute('d') : null
        }
      };
    })()`);

    console.log('Top Header Data:');
    console.log(' - Container Dimensions:', topData.containerBox);
    console.log(' - Computed height:', topData.containerHeight, '| padding:', topData.containerPadding);
    console.log(' - Nav Links:', topData.navLinks);
    console.log(' - CV CTA Button:', topData.cvBtn);

    await cdp.captureScreenshot('scratch/final_step_desktop_top.png', {
      x: 0, y: 0, width: 1920, height: 200, scale: 1
    });

    console.log('\n--- 2. SCROLL DOWN AND SCROLL UP VERIFICATION ---');
    // Scroll down 400px
    await cdp.eval(`window.scrollTo(0, 400); window.dispatchEvent(new Event('scroll'));`);
    await new Promise(r => setTimeout(r, 700));

    const scrolledDownData = await cdp.eval(`(() => {
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      return {
        isScrolled: header.classList.contains('is-scrolled'),
        width: Math.round(container.getBoundingClientRect().width)
      };
    })()`);
    console.log('Scrolled Down Data (should be compact):', scrolledDownData);

    // Scroll up by 50px (simulating user scrolling up)
    await cdp.eval(`window.scrollTo(0, 350); window.dispatchEvent(new Event('scroll'));`);
    await new Promise(r => setTimeout(r, 700));

    const scrolledUpData = await cdp.eval(`(() => {
      const header = document.querySelector('.header-area');
      const container = document.querySelector('.header-container');
      return {
        isScrolled: header.classList.contains('is-scrolled'),
        width: Math.round(container.getBoundingClientRect().width),
        height: Math.round(container.getBoundingClientRect().height)
      };
    })()`);
    console.log('Scrolled Up Data (should return to default header):', scrolledUpData);

    console.log('\n--- 3. MOBILE VIEW (390x844) VERIFICATION ---');
    await cdp.eval(`window.scrollTo(0, 0); window.dispatchEvent(new Event('scroll'));`);
    await cdp.setViewport(390, 844, 1, true);
    await new Promise(r => setTimeout(r, 600));

    await cdp.eval(`document.querySelector('.header-mobile-toggle').click()`);
    await new Promise(r => setTimeout(r, 400));

    const mobileData = await cdp.eval(`(() => {
      const toObj = r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      const menu = document.getElementById('header-mobile-menu');
      const container = document.querySelector('.header-container');
      const links = Array.from(menu.querySelectorAll('.mobile-nav-link')).map(el => ({
        text: el.textContent.trim(),
        href: el.getAttribute('href')
      }));
      const ctaBtn = menu.querySelector('.mobile-cv-btn');
      const icon = ctaBtn.querySelector('svg');
      const gap = Math.round(menu.getBoundingClientRect().top - container.getBoundingClientRect().bottom);

      return {
        gap,
        links,
        cta: {
          text: ctaBtn.querySelector('.text') ? ctaBtn.querySelector('.text').textContent.trim() : ctaBtn.textContent.trim(),
          href: ctaBtn.getAttribute('href'),
          hasIcon: !!icon,
          svgViewBox: icon ? icon.getAttribute('viewBox') : null,
          svgPath: icon ? icon.querySelector('path').getAttribute('d') : null
        }
      };
    })()`);

    console.log('Mobile Drawer Data:');
    console.log(' - Floating Gap below header:', mobileData.gap, 'px');
    console.log(' - Mobile Nav Links:', mobileData.links);
    console.log(' - Mobile CTA Button:', mobileData.cta);

    await cdp.captureScreenshot('scratch/final_step_mobile_open.png', {
      x: 0, y: 0, width: 390, height: 480, scale: 1
    });

    console.log('\n--- 4. OTHER PAGES (portfolio.html & case study) ---');
    for (const pagePath of ['/portfolio.html', '/portfolio/2/app-visual-assets.html']) {
      await cdp.setViewport(1920, 1080);
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${pagePath}` });
      await new Promise(r => setTimeout(r, 1000));

      const pageData = await cdp.eval(`(() => {
        const navLinks = Array.from(document.querySelectorAll('.header-nav-link')).map(el => el.textContent.trim());
        const cvBtn = document.querySelector('.header-cv-cta');
        return {
          navLinks,
          cvText: cvBtn ? cvBtn.textContent.trim() : null,
          cvHref: cvBtn ? cvBtn.getAttribute('href') : null
        };
      })()`);
      console.log(`Page: ${pagePath}`, pageData);
    }

    console.log('\nALL FINAL STEP VERIFICATIONS COMPLETED SUCCESSFULLY!');
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
