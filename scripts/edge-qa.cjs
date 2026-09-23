/** Reusable Windows-native Playwright/Edge screenshot and smoke check. */
const fs = require("node:fs");
const path = require("node:path");

const runtimeRoot = path.join(process.env.LOCALAPPDATA || "", "MixtureX", "edge-qa");
const { chromium } = require(path.join(runtimeRoot, "node_modules", "playwright"));

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

async function main() {
  const url = option("--url", "http://localhost:4173/");
  const output = option("--output", path.join(runtimeRoot, "captures", "assistant-home.png"));
  const width = Number(option("--width", "430"));
  const height = Number(option("--height", "1050"));
  const scale = Number(option("--scale", "2"));
  const tab = option("--tab", "assistant");
  const clickAction = option("--click-action", "");
  const expectedScreen = option("--expect-screen", "");
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(scale) || width < 1 || height < 1 || scale < 1) {
    throw new Error("width, height, and scale must be positive integers");
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const httpErrors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
  try {
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (tab !== "none") {
      await page.getByTestId(`tab-${tab}`).click();
      await page.waitForLoadState("networkidle");
    }
    if (clickAction) {
      await page.locator(`[data-action="${clickAction}"]`).first().click();
      await page.waitForLoadState("networkidle");
    }
    let assistantScreen = await page.locator("[data-assistant-screen]").first().getAttribute("data-assistant-screen").catch(() => null);
    if (assistantScreen === null && new URL(url).pathname === "/_preview/iphone") {
      assistantScreen = await page.frameLocator(".iphone-screen").locator("[data-assistant-screen]").first().getAttribute("data-assistant-screen").catch(() => null);
    }
    if (expectedScreen && assistantScreen !== expectedScreen) {
      throw new Error(`Expected assistant screen ${expectedScreen}, got ${assistantScreen}`);
    }
    await page.screenshot({ path: output, fullPage: false });
    const result = { url: page.url(), status: response?.status(), title: await page.title(), screenshot: output, viewport: { width, height, scale }, tab, clickAction: clickAction || null, assistantScreen, errors, httpErrors };
    fs.writeFileSync(output.replace(/\.png$/i, ".json"), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!response?.ok() || errors.length > 0 || httpErrors.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
