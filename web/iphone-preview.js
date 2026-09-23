const appFrame = document.querySelector(".iphone-screen");
let attempts = 0;

const assistantTabTimer = window.setInterval(() => {
  attempts += 1;
  try {
    const assistantTab = appFrame.contentDocument?.querySelector('[data-testid="tab-assistant"]');
    if (assistantTab !== null && assistantTab !== undefined) {
      if (assistantTab.getAttribute("aria-current") !== "page") assistantTab.click();
      window.clearInterval(assistantTabTimer);
    }
  } catch {
    window.clearInterval(assistantTabTimer);
  }
  if (attempts >= 120) window.clearInterval(assistantTabTimer);
}, 250);
