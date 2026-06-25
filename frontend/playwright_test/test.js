const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting playwright...");
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
  });
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log("Navigating to http://localhost:3000...");
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Wait for the app to load
  await page.waitForTimeout(1000);

  // Take initial screenshot
  await page.screenshot({ path: 'step1_loaded.png' });
  console.log("Saved step1_loaded.png");

  await browser.close();
  console.log("Done.");
})();
