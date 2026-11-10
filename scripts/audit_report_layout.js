// Layout audit for the report deck: renders each report and lists any table or text block that is
// still clipped after layout. Serve site/ locally first (make serve), then:
//   node scripts/audit_report_layout.js "report?rl=country&rm=cmp&ids=IT,ES,EL,PT&ry=2025&rn=10&go=1" ...
// Needs Playwright with Chromium. BASE overrides the server (default http://localhost:8000/).
const { chromium } = require("playwright");

(async () => {
  const base = process.env.BASE || "http://localhost:8000/";
  const browser = await chromium.launch();
  let failures = 0;
  for (const hash of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}#${hash}`);
    await page.waitForSelector(".sl", { timeout: 60000 });
    await page.waitForTimeout(2000);
    const result = await page.evaluate(() => {
      const clipped = [];
      document.querySelectorAll(".sl").forEach((sl, i) => {
        sl.querySelectorAll(".sl-tablewrap, .sl-text, .sl-body").forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) clipped.push(`slide ${i + 1}: ${el.className}`);
        });
      });
      return { slides: document.querySelectorAll(".sl").length, clipped };
    });
    if (result.clipped.length || errors.length) failures++;
    console.log(`${hash}\n  slides ${result.slides}, clipped ${result.clipped.length}${result.clipped.length ? `: ${result.clipped.join("; ")}` : ""}${errors.length ? `\n  errors: ${errors.join("; ")}` : ""}`);
    await page.close();
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
