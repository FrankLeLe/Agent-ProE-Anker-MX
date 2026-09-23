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
  const composerRegionOutput = option("--capture-composer-region", "");
  const width = Number(option("--width", "430"));
  const height = Number(option("--height", "1050"));
  const scale = Number(option("--scale", "2"));
  const tab = option("--tab", "assistant");
  const clickAction = option("--click-action", "");
  const focusComposer = option("--focus-composer", "false") === "true";
  const captureEachAction = option("--capture-each-action", "false") === "true";
  const captureNames = option("--capture-names", "").split(",").filter(Boolean);
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
    const appFrame = new URL(url).pathname === "/_preview/iphone"
      ? page.frames().find(frame => frame !== page.mainFrame())
      : null;
    if (tab !== "none") {
      if (appFrame) await appFrame.getByTestId(`tab-${tab}`).click();
      else await page.getByTestId(`tab-${tab}`).click();
      await page.waitForLoadState("networkidle");
    }
    if (focusComposer) {
      const frame = appFrame ?? page;
      await frame.locator('[data-assistant-field="composer"]').focus();
      await page.waitForTimeout(100);
    }
    const actionScreenshots = [];
    if (clickAction) {
      const frame = appFrame ?? page;
      const actions = clickAction.split(",").filter(Boolean);
      for (const [index, action] of actions.entries()) {
        await frame.locator(`[data-action="${action}"]`).first().click();
        await page.waitForLoadState("networkidle");
        if (captureEachAction) {
          const name = captureNames[index] || `step-${index + 1}`;
          const actionOutput = output.replace(/\.png$/i, `-${name}.png`);
          await page.screenshot({ path: actionOutput, fullPage: false });
          actionScreenshots.push(actionOutput);
        }
      }
    }
    const inspectedFrame = appFrame ?? page;
    const moduleScreen = await inspectedFrame.locator(".mx-page-head h1, .mx-topline h1").first().textContent().catch(() => null);
    let assistantScreen = await page.locator("[data-assistant-screen]").first().getAttribute("data-assistant-screen").catch(() => null);
    let assistantComposerLayout = null;
    let scrollCheck = null;
    if (assistantScreen === null && new URL(url).pathname === "/_preview/iphone") {
      const frame = appFrame ?? page.frames().find(candidate => candidate !== page.mainFrame());
      if (frame) {
        assistantScreen = await frame.locator("[data-assistant-screen]").first().getAttribute("data-assistant-screen").catch(() => null);
        assistantComposerLayout = await frame.evaluate(() => {
          const composer = document.querySelector(".v4-composer-shell");
          const navigation = document.querySelector(".sidebar");
          if (!(composer instanceof HTMLElement) || !(navigation instanceof HTMLElement)) return null;
          const composerRect = composer.getBoundingClientRect();
          const navigationRect = navigation.getBoundingClientRect();
          const voice = composer.querySelector(".v4-voice-button, .v4-send-button");
          const voiceRect = voice?.getBoundingClientRect();
          return {
            composerTop: Math.round(composerRect.top),
            composerBottom: Math.round(composerRect.bottom),
            navigationTop: Math.round(navigationRect.top),
            navigationBottom: Math.round(navigationRect.bottom),
            voiceTop: voiceRect ? Math.round(voiceRect.top) : null,
            voiceBottom: voiceRect ? Math.round(voiceRect.bottom) : null,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            gap: Math.round(navigationRect.top - composerRect.bottom)
          };
        });
        scrollCheck = await frame.evaluate(async () => {
          const root = document.scrollingElement;
          if (!root) return { canScroll: false, moved: false, scrollbarWidth: "unsupported", webkitScrollbarDisplay: "unsupported" };
          const maxScroll = Math.max(0, root.scrollHeight - document.documentElement.clientHeight);
          const start = root.scrollTop;
          root.scrollTop = Math.min(maxScroll, start + 160);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const result = {
            canScroll: maxScroll > 0,
            moved: root.scrollTop > start,
            scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
            webkitScrollbarDisplay: getComputedStyle(document.documentElement, "::-webkit-scrollbar").display
          };
          root.scrollTop = start;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return result;
        });
      }
    }
    if (expectedScreen && assistantScreen !== expectedScreen) {
      throw new Error(`Expected assistant screen ${expectedScreen}, got ${assistantScreen}`);
    }
    if (composerRegionOutput) {
      if (!appFrame || !assistantComposerLayout) throw new Error("Composer region capture requires the iPhone preview and an assistant screen.");
      const frameRect = await page.locator("iframe.iphone-screen").boundingBox();
      if (!frameRect) throw new Error("Could not measure the iPhone app viewport.");
      const scaleX = frameRect.width / assistantComposerLayout.viewport.width;
      const scaleY = frameRect.height / assistantComposerLayout.viewport.height;
      const topPadding = Math.min(100, assistantComposerLayout.composerTop);
      const clip = {
        x: frameRect.x,
        y: frameRect.y + (assistantComposerLayout.composerTop - topPadding) * scaleY,
        width: frameRect.width,
        height: (assistantComposerLayout.navigationBottom - assistantComposerLayout.composerTop + topPadding) * scaleY
      };
      fs.mkdirSync(path.dirname(composerRegionOutput), { recursive: true });
      await page.screenshot({ path: composerRegionOutput, clip });
    }
    await page.screenshot({ path: output, fullPage: false });
    const result = { url: page.url(), status: response?.status(), title: await page.title(), screenshot: output, composerRegionScreenshot: composerRegionOutput || null, actionScreenshots, moduleScreen: moduleScreen?.trim() ?? null, viewport: { width, height, scale }, tab, clickAction: clickAction || null, assistantScreen, assistantComposerLayout, scrollCheck, errors, httpErrors };
    fs.writeFileSync(output.replace(/\.png$/i, ".json"), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!response?.ok() || errors.length > 0 || httpErrors.length > 0 || (scrollCheck !== null && (!scrollCheck.canScroll || !scrollCheck.moved || scrollCheck.scrollbarWidth !== "none" || scrollCheck.webkitScrollbarDisplay !== "none"))) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
