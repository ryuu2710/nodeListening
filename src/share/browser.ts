import puppeteer, { Browser, Page } from "puppeteer";

export async function getMyCustomRemoteBrowser(): Promise<Browser> {
  return await puppeteer.connect({
    browserURL: `http://${process.env.CHROME_PROFILE_DEVTOOLS_HOST}:${process.env.CHROME_PROFILE_DEVTOOLS_PORT}`,
    defaultViewport: null,
  });
}

/**
 * Performs one pass of smooth scrolling to bottom.
 */
export async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

export function delay(time: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time)
  });
}
