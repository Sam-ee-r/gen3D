const puppeteer = require('puppeteer');

(async () => {
  console.log("Starting puppeteer...");
  const browser = await puppeteer.launch({ 
    headless: "new",
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
  });
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log("Navigating to http://localhost:3000...");
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  console.log("Waiting for model-viewer to load...");
  await page.waitForSelector('model-viewer');

  // Wait a bit for the 3D model to actually render
  await new Promise(r => setTimeout(r, 2000));

  console.log("Activating sticker tab...");
  // Find the button that sets value="decal" or similar.
  const tabs = await page.$$('button[role="tab"]');
  for (const tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text && text.toLowerCase().includes('decal')) {
      await tab.click();
      console.log("Clicked Decals tab.");
      break;
    }
  }

  await new Promise(r => setTimeout(r, 1000));

  console.log("Uploading a test image or clicking model-viewer...");
  // If we just click without an active sticker, what happens? 
  // Let's just click and see if any error is thrown in console.
  const modelViewer = await page.$('model-viewer');
  if (modelViewer) {
    const boundingBox = await modelViewer.boundingBox();
    if (boundingBox) {
      await page.mouse.click(
        boundingBox.x + boundingBox.width / 2,
        boundingBox.y + boundingBox.height / 2
      );
      console.log("Clicked at center of model-viewer.");
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshot.png' });
  console.log("Saved screenshot to screenshot.png");

  await browser.close();
  console.log("Done.");
})();
