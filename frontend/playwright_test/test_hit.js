const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const el = document.querySelector('model-viewer');
    if (!el) return 'No model viewer';
    
    // Ensure scene is rendered
    await new Promise(r => setTimeout(r, 1000));
    
    const rect = el.getBoundingClientRect();
    
    // We want to test the center of the model viewer
    const centerX_viewport = rect.left + rect.width / 2;
    const centerY_viewport = rect.top + rect.height / 2;
    
    const centerX_element = rect.width / 2;
    const centerY_element = rect.height / 2;
    
    // Test viewport coordinates
    const resViewport = el.positionAndNormalFromPoint(centerX_viewport, centerY_viewport);
    // Test element coordinates
    const resElement = el.positionAndNormalFromPoint(centerX_element, centerY_element);
    
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      resViewport: !!resViewport,
      resElement: !!resElement,
      resViewportData: resViewport ? { p: resViewport.position, n: resViewport.normal } : null,
      resElementData: resElement ? { p: resElement.position, n: resElement.normal } : null
    };
  });
  
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
