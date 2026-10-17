// Record the demo as a 1920x1080 video: dashboard on the left, 3D reconstruction opened on the right.
//
// Uses your installed Google Chrome through Playwright and records the page itself (no screen
// recording permission, no other windows captured).
//
//   cd software/tools && npm install --no-save playwright-core
//   node record_demo.mjs                      # dashboard must be running on http://localhost:8000
//
// Options (environment): URL, RECORDING (default sim-test-event-01), SPEED (default 4), OUT (folder).
// Writes <OUT>/*.webm; convert with: ffmpeg -i in.webm -c:v libx264 -crf 20 -pix_fmt yuv420p demo.mp4
import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://localhost:8000';
const RECORDING = process.env.RECORDING || 'sim-test-event-01';
const SPEED = process.env.SPEED || '4';
const OUT = process.env.OUT || 'demo-recording';
const W = 1920, H = 1080;

// A visible cursor that glides to each click target (recorded video has no system cursor).
const cursorScript = () => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9.5 19z" fill="#13283a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '60%', top: '55%', zIndex: 99999, pointerEvents: 'none',
      transition: 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1)' });
    document.body.appendChild(c);
    window.__demoCursor = (x, y) => { c.style.left = `${x - 4}px`; c.style.top = `${y - 2}px`; };
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: '36px', height: '36px',
        borderRadius: '50%', border: '3px solid #0f7c8c', zIndex: 99998, pointerEvents: 'none', transition: 'transform .5s, opacity .5s' });
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  });
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H + 120}`],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const page = await context.newPage();
await page.addInitScript(cursorScript);

async function click(selector) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => window.__demoCursor?.(px, py), [x, y]);
  await page.waitForTimeout(900);
  await page.mouse.click(x, y);
}

await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('#recSelect option').length > 0 && !document.getElementById('startBtn').disabled, null, { timeout: 600000 });
await page.selectOption('#recSelect', RECORDING);
await page.selectOption('#speedSel', SPEED);
await page.waitForTimeout(3000);                      // establishing shot: quiet harbour
await click('#startBtn');
await page.waitForSelector('#vizBtn:not([hidden])', { timeout: 300000 });
await page.waitForTimeout(3000);                      // the alert lands on the dashboard first
await click('#vizBtn');                               // open the 3D reconstruction on the right
await page.locator('[data-verdict="confirmed intrusion"]').waitFor({ state: 'visible', timeout: 600000 });
await page.waitForTimeout(3500);                      // sonar contact in both views
await click('[data-verdict="confirmed intrusion"]');
await page.waitForTimeout(10000);                     // outcome
const video = page.video();
await context.close();
console.log('saved', await video.path());
await browser.close();
