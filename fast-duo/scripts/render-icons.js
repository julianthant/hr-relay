// Open this project's src/icons/autopilot.svg in playwright-cli first.
// Run from the project root: playwright-cli run-code --filename=scripts/render-icons.js.
// Render the vector on a genuinely transparent document, never over app chrome.
async page => {
  const svg = await page.locator('svg').evaluate(el => el.outerHTML);
  await page.goto('about:blank');
  await page.setContent(`<html style="background:transparent"><body style="margin:0;background:transparent">${svg}</body></html>`);
  const results = [];
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.locator('svg').evaluate((el, size) => {
      el.setAttribute('width', size);
      el.setAttribute('height', size);
      el.style.display = 'block';
    }, size);
    await page.screenshot({
      path: `src/icons/autopilot-${size}.png`,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
      scale: 'css',
    });
    results.push(`${size} × ${size}`);
  }
  return results;
}
