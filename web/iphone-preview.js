const appFrame = document.querySelector(".iphone-screen");
let attempts = 0;

const todayTabTimer = window.setInterval(() => {
  attempts += 1;
  try {
    const todayTab = appFrame.contentDocument?.querySelector('[data-testid="tab-today"]');
    if (todayTab !== null && todayTab !== undefined) {
      if (todayTab.getAttribute("aria-current") !== "page") todayTab.click();
      window.clearInterval(todayTabTimer);
    }
  } catch {
    window.clearInterval(todayTabTimer);
  }
  if (attempts >= 120) window.clearInterval(todayTabTimer);
}, 250);
