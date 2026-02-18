const viewport = { width: 1280, height: 800 };
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  const toIn = (px) => `${px / 96}in`; // Chromium uses 96 CSS px per inch

  await page.goto('https://dydra.com/ui/user', {
    waitUntil: 'domcontentloaded'
  });
    await page.emulateMedia({ media: 'screen' });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForFunction(() => document.styleSheets.length > 0);
    
  await page.pdf({
    path: 'login.pdf',
    // format: 'A4',
      printBackground: true,
    width: toIn(viewport.width),
    height: toIn(viewport.height),
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    pageRanges: '1'
  });

  await browser.close();
})();
