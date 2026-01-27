import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { injectable } from "tsyringe";
import { promises as fs } from "fs";
import pino from "pino";
import {
  API_CONTENT_TYPE,
  CDP_NETWORK_ENABLE_TO_SEND,
  DEBUG_ENV,
  FB_DEFAULT_ENDPOINT,
  FB_ENDPOINT_GROUP_KEY,
  FB_GROUP_API_REQUEST_FRIENDLY_NAME,
  FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME,
  FB_POST_COMMENT_API_REQUEST_FRIENDLY_NAME,
  FB_USER_PROFILE_API_REQUEST_FRIENDLY_NAME,
  HTTP_POST_METHOD,
  INFO_ENV,
  PPT_REQUEST_KEY,
  PPT_TIMEOUT_DEFAULT,
  PPT_WAIT_UNTIL_DEFAULT,
  PRODUCTION_ENV,
  QUERY_PARAMS_CHRONOLOGICAL_ACTIVITY,
  TWENTY,
} from "#constants/index.js";
import { Browser, Page } from "puppeteer";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import {
  FacebookFetchOptions,
  ScrapePerformanceContextParams,
  ScrapeResultGenParams,
  ScrapeResultParams,
} from "#types/index.js";
import { BuildFbRequestOptionsForCallApi, WaitNextGraphQL } from "#share/fb.js";
import {
  fetchAndProcessBatchGqlData,
  getCookiesFromCurrentPage,
} from "#share/api.js";
import { FormatVnTimeMsg } from "#share/display.js";
import { SocialFbComment, SocialFbMention } from "./fb.types";
import {
  extractCommentFromRawJson,
  extractFanpagePostsFromRawJson,
  extractPostsFromRawJson,
  normalizeFacebookPost,
} from "./fb.clean";
import { buildFbGroupSearchUrl } from "./fb.builder";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

puppeteerExtra.use(StealthPlugin());

@injectable()
export default class FbScraperService {
  constructor() {}

  public async humanScroll(page: Page) {
    try {
      await page.mouse.move(500, 500);
      await page.mouse.wheel({ deltaY: 1000 });

      await page.evaluate(async () => {
        window.scrollBy({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      });

      const pause = Math.floor(Math.random() * 2000) + 2000;
      await new Promise((r) => setTimeout(r, pause));
    } catch (e) {
      console.log("Scroll error ignored");
    }
  }

  public async scrapeGroupPostsByFilterParams(
    projectId: string,
    groupId: string | number,
    scrollTimes: number = TWENTY,
    keyword: string,
    year?: number,
  ): Promise<ScrapeResultGenParams<SocialFbMention[]>> {
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();
    const cleanedPosts: SocialFbMention[] = [];

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on(PPT_REQUEST_KEY, (req) => req.continue());

      // Open CDP Network domain to get postData fallback
      const client = await page.target().createCDPSession();

      // set the viewport of browser

      const { windowId } = await client.send("Browser.getWindowForTarget");
      await client.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "fullscreen" },
      });

      await client.send(CDP_NETWORK_ENABLE_TO_SEND);

      await page.setViewport({
        width: 0,
        height: 0,
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
      });

      // prebuild the url
      let targetURL = "";
      if (keyword) {
        targetURL = buildFbGroupSearchUrl(groupId.toString(), keyword, year);
        logger.info(`Navigating to the search page: ${targetURL}`);
      } else {
        targetURL = `${FB_DEFAULT_ENDPOINT}/${FB_ENDPOINT_GROUP_KEY}/${groupId}?${QUERY_PARAMS_CHRONOLOGICAL_ACTIVITY}`;
        logger.info(`Navigating to Newsfeed: ${targetURL}`);
      }
      logger.info(`Navigating to ${targetURL}`);

      await page.goto(targetURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      // trigger recent posts button
      if (keyword) {
        try {
          logger.info("Checking the status of the 'Recent Posts' button...");
          const toggleSelector =
            'input[role="switch"][aria-label="Recent Posts"]';
          const toggleInput = await page
            .waitForSelector(toggleSelector, { timeout: 5000 })
            .catch(() => null);

          if (toggleInput) {
            const isChecked = await toggleInput.evaluate(
              (el) => el.getAttribute("aria-checked") === "true",
            );

            if (!isChecked) {
              logger.info(
                "The button is currently DISABLED. Click to turn it on...",
              );
              await toggleInput.evaluate((el) => (el as HTMLElement).click());

              await new Promise((r) => setTimeout(r, 3000));
              logger.info("'Recent Posts' has been successfully enabled.");
            } else {
              logger.info("The button is already enabled (due to URL filter).");
            }
          } else {
            logger.warn("'Recent Posts' button not found in DOM.");
          }
        } catch (e) {
          logger.warn(
            "Error when using the Recent Posts button (Skip to continue):",
            e as any,
          );
        }
      }

      for (let i = 0; i < scrollTimes; i++) {
        // capture network GQL requests
        const networkRacePromise = Promise.race([
          WaitNextGraphQL(
            client,
            FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME,
          ).then((res) => ({ status: "SUCCESS", data: res })),
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: "TIMEOUT", data: null }), 10000),
          ),
        ]);

        // immitate human scroll behaviour
        await this.humanScroll(page);

        await page.evaluate(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth",
          });
        });

        const result = (await networkRacePromise) as {
          status: string;
          data: any;
        };

        if (result.status === "TIMEOUT") {
          logger.warn(`Scroll ${i + 1}: Timeout - no data found.`);
          break;
        }

        const { headers, bodyRaw } = result.data;
        logger.info(
          `Snapshot request '${FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME}'`,
        );

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions =
          await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
        const processedBatchFbData = await fetchAndProcessBatchGqlData(
          fbRequestOptionsBuilderForCallApi,
          logger,
        );

        if (processedBatchFbData) {
          try {
            const jsonData =
              typeof processedBatchFbData === "string"
                ? JSON.parse(processedBatchFbData)
                : processedBatchFbData;
            const rawStoriesAccessor = extractPostsFromRawJson(jsonData);

            if (rawStoriesAccessor.length > 0) {
              const batchCleanPosts = rawStoriesAccessor
                .map((story: any) => normalizeFacebookPost(story))
                .filter((post): post is SocialFbMention => post !== null);
              cleanedPosts.push(...batchCleanPosts);
              logger.info(
                `Cleaned and added the ${batchCleanPosts.length} posts.`,
              );
              await page.evaluate(() => {
                window.scrollTo({
                  top: document.body.scrollHeight,
                  behavior: "smooth",
                });
              });
            }
          } catch (parseError) {
            logger.error(
              "Error parsing batch GraphQL data:",
              parseError as any,
            );
          }
        }

        await page.evaluate(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth",
          });
        });
      }

      const scrapeEndTime = Date.now();
      const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

      logger.info(`Start time scraping: ${FormatVnTimeMsg(scrapeStartTime)}`);
      logger.info(`End time scraping: ${FormatVnTimeMsg(scrapeEndTime)}`);
      logger.info(
        `Total data collection time: ${(scrapeDurationInMs / 1000).toFixed(2)} seconds.`,
      );

      const scrapeResult: ScrapeResultGenParams<SocialFbMention[]> = {
        performance: {
          totalDurationMs: scrapeDurationInMs,
          timestamps: {
            scrapeStartTime: scrapeStartTime,
            scrapeEndTime: scrapeEndTime,
          },
          breakdown: {
            mainProductPageMs: scrapeDurationInMs,
            camelPageMs: 0,
            feedbackPagesMs: 0,
            finalProcessingMs: 0,
          },
        },
        count: cleanedPosts.length,
        data: cleanedPosts,
      };

      return scrapeResult;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        logger.info("Done, closed browser connection.");
        await browser.disconnect();
      }
    }
  }

  /**
 * Check xem Fanpage hiện tại có tích xanh không.
 * Logic: Tìm thẻ h1 (Tên Page) -> Quét các SVG xung quanh xem có cái nào title là Verified không.
 */
  public async checkIsFanpageVerified(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const verifyKeywords = [
      'Verified account', 
      'Tài khoản đã xác minh', 
      'Đã xác minh',
      'Verified'
    ];

    const h1 = document.querySelector('h1');
    if (!h1) return false;
    const headerContainer = h1.closest('div[role="main"]') || h1.parentElement?.parentElement || document.body;
    const svgs = headerContainer.querySelectorAll('svg');

    for (const svg of svgs) {
      const titleTag = svg.querySelector('title');
      if (titleTag && titleTag.textContent) {
        if (verifyKeywords.includes(titleTag.textContent)) return true;
      }

      const titleAttr = svg.getAttribute('title');
      if (titleAttr && verifyKeywords.includes(titleAttr)) return true;

      const ariaLabel = svg.getAttribute('aria-label');
      if (ariaLabel && verifyKeywords.includes(ariaLabel)) return true;
    }

    return false;
  });
}

  public async scrapeFanpagePosts(targetURL: string, sinceDate: Date): Promise<SocialFbMention[]>{
    // 1. Goto Page URL
    // 2. Loop Scroll
    // 3. Parse HTML từng bài post trên feed để lấy ID, Content, Date
    // 4. Nếu Date < sinceDate -> Break Loop
    // 5. Return List Posts
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();
    const cleanedPosts: any[] = [];
    let isKeepScrolling = true;
    let timeoutCount = 0;
    const MAX_TIMEOUT_RETRIES = 3;

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on(PPT_REQUEST_KEY, (req) => req.continue());

      // Open CDP Network domain to get postData fallback
      const client = await page.target().createCDPSession();

      // set the viewport of browser
      const { windowId } = await client.send("Browser.getWindowForTarget");
      await client.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "fullscreen" },
      });

      await client.send(CDP_NETWORK_ENABLE_TO_SEND);

      await page.setViewport({
        width: 0,
        height: 0,
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
      });

      await page.goto(targetURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      // Is verified user?
      const isVerified = await this.checkIsFanpageVerified(page);
      logger.info(`Fanpage Verified Status: ${isVerified}`);

      while(isKeepScrolling) {
        const networkRacePromise = Promise.race([
          WaitNextGraphQL(client, FB_USER_PROFILE_API_REQUEST_FRIENDLY_NAME).then(
            (res) => ({
              status: "SUCCESS",
              data: res,
            }),
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: "TIMEOUT", data: null }), 5000),
          ),
        ]);

        // immitate human scroll behaviour
        await this.humanScroll(page);

        await page.evaluate(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth",
          });
        });

        const result = (await networkRacePromise) as {
          status: string;
          data: any;
        };

        if (result.status === "TIMEOUT") {
          timeoutCount++;
          logger.warn(`Scroll Timeout (${timeoutCount}/${MAX_TIMEOUT_RETRIES}). No new data.`);

          if (timeoutCount >= MAX_TIMEOUT_RETRIES) {
            logger.info("Max timeouts reached. Stopping scrape.");
            isKeepScrolling = false;
            break;
          }
          continue;
        }

        // if data found ==> reset timeout count
        timeoutCount = 0;
        const { headers, bodyRaw } = result.data;
        logger.info(
          `Snapshot request '${FB_USER_PROFILE_API_REQUEST_FRIENDLY_NAME}'`,
        );

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions =
          await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
        const processedBatchFbData = await fetchAndProcessBatchGqlData(
          fbRequestOptionsBuilderForCallApi,
          logger,
        );

        if(processedBatchFbData) {
          const jsonData = typeof processedBatchFbData === "string"
            ? JSON.parse(processedBatchFbData)
            : processedBatchFbData;
          const batchPosts = extractFanpagePostsFromRawJson(jsonData, isVerified);

          if (batchPosts.length > 0) {
            const validPosts = batchPosts.filter(post => {
              return post.publishedAt >= sinceDate;
            })
            cleanedPosts.push(...validPosts);
            logger.info(`Collected ${validPosts.length} posts from batch.`);

            const lastPostInBatch = batchPosts[batchPosts.length - 1];
            if (lastPostInBatch && lastPostInBatch.publishedAt < sinceDate) {
               logger.info(`Found post from ${lastPostInBatch.publishedAt.toISOString()} which is older than ${sinceDate.toISOString()}. Stopping.`);
               isKeepScrolling = false;
            }
          } else {
             logger.warn("Batch has no edges (might be empty feed unit).");
          }
        }
      }
    } catch(error) {
      logger.error("Error scraping fanpage:", error as any);
    } finally {
      if (browser) {
        browser.disconnect();
      }
    }
      
    return cleanedPosts;
  }

  public async scrapeCommentsOfPost() {
    const targetURL =
      "https://www.facebook.com/groups/reviewcactiemcaphesaigon/posts/3401776906795134/";
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();
    const cleanedComments: SocialFbComment[] = [];

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on(PPT_REQUEST_KEY, (req) => req.continue());

      // Open CDP Network domain to get postData fallback
      const client = await page.target().createCDPSession();

      // set the viewport of browser

      const { windowId } = await client.send("Browser.getWindowForTarget");
      await client.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "fullscreen" },
      });

      await client.send(CDP_NETWORK_ENABLE_TO_SEND);

      await page.setViewport({
        width: 0,
        height: 0,
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
      });

      await page.goto(targetURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      // toggle button from "Most Relevant" -> "All Comments"
      this.switchCommentsViewMode(page);

      for (let i = 0; i < 20; i++) {
        const networkPromises = Promise.race([
          WaitNextGraphQL(client, FB_POST_COMMENT_API_REQUEST_FRIENDLY_NAME).then(
            (res) => ({
              status: "SUCCESS",
              data: res,
            }),
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: "TIMEOUT", data: null }), 5000),
          ),
        ]);

        await page.evaluate(async () => {
          const dialog = document.querySelector('div[role="dialog"]');
          let target = dialog as HTMLElement;

          if (dialog) {
            const scrollableChild = Array.from(
              dialog.querySelectorAll("*"),
            ).find((el) => {
              const e = el as HTMLElement;
              return (
                e.scrollHeight > e.clientHeight &&
                ["auto", "scroll"].includes(
                  window.getComputedStyle(e).overflowY,
                )
              );
            });
            if (scrollableChild) target = scrollableChild as HTMLElement;
          } else {
            target = document.documentElement; // Fallback window
          }

          target.scrollBy({ top: 500, behavior: "smooth" });

          if (target.scrollTop + target.clientHeight < target.scrollHeight) {
            setTimeout(() => {
              target.scrollTop = target.scrollHeight;
            }, 500);
          }
        });

        const result = (await networkPromises) as { status: string; data: any };
        if (result.status === "TIMEOUT" || !result.data) {
          console.warn(
            `Loop ${i + 1}: No new GraphQL request captured (Timeout).`,
          );
          continue;
        }

        const { headers, bodyRaw } = result.data;
        console.log(`Captured ${FB_POST_COMMENT_API_REQUEST_FRIENDLY_NAME}`);

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptions = await BuildFbRequestOptionsForCallApi(
          headers,
          bodyRaw,
          cookieStr,
        );
        const processedBatchData = await fetchAndProcessBatchGqlData(
          fbRequestOptions,
          logger,
        );

        if (processedBatchData) {
          try {
            // Parse to json node
            const jsonData =
              typeof processedBatchData === "string"
                ? JSON.parse(processedBatchData)
                : processedBatchData;

            console.log(`Cleaned comment batch successfully.`);

            // Parse to json dto
            const batchComments: SocialFbComment[] = extractCommentFromRawJson(jsonData);
            batchComments.map((data) => cleanedComments.push(data));
          } catch (parseError) {
            console.error("Error parsing GraphQL data:", parseError);
          }
        }
      }

      console.log(`\nCollected ${cleanedComments.length} comments`);
      return cleanedComments;
    } catch (error) {
      console.error("Error in scrapeCommentsOfPost:", error);
    } finally {
      if (browser) {
        await browser.disconnect();
      }
    }
  }

  public async scrapeGroupPosts(
    projectId: string,
    groupId: string | number,
    scrollTimes: number = TWENTY,
    token: string,
  ): Promise<ScrapeResultParams> {
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();

    const cleanedPosts: SocialFbMention[] = [];

    // const
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on(PPT_REQUEST_KEY, (req) => req.continue());

      // Open CDP Network domain to get postData fallback
      const client = await page.target().createCDPSession();

      const { windowId } = await client.send("Browser.getWindowForTarget");
      await client.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width: 1920, height: 1080, windowState: "normal" },
      });

      await client.send(CDP_NETWORK_ENABLE_TO_SEND);

      await page.setViewport({
        width: 1920,
        height: 1080,
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
      });

      const groupURL: string = `${FB_DEFAULT_ENDPOINT}/${FB_ENDPOINT_GROUP_KEY}/${groupId}?${QUERY_PARAMS_CHRONOLOGICAL_ACTIVITY}`;
      logger.info(`Đang điều hướng tới ${groupURL}`);

      await page.goto(groupURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      for (let i = 0; i < scrollTimes; i++) {
        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight });
        });

        const { headers, bodyRaw } = await WaitNextGraphQL(
          client,
          FB_GROUP_API_REQUEST_FRIENDLY_NAME,
        );
        logger.info(`Bắt được request '${FB_GROUP_API_REQUEST_FRIENDLY_NAME}'`);

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions =
          await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
        const processedBatchFbData = await fetchAndProcessBatchGqlData(
          fbRequestOptionsBuilderForCallApi,
          logger,
        );

        if (processedBatchFbData) {
          try {
            const jsonData =
              typeof processedBatchFbData === "string"
                ? JSON.parse(processedBatchFbData)
                : processedBatchFbData;

            const edges = jsonData?.data?.node?.group_feed?.edges || [];
            if (Array.isArray(edges)) {
              const batchCleanPosts = edges
                .map((edge: any) => normalizeFacebookPost(edge.node))
                .filter((post): post is SocialFbMention => post !== null); // Lọc null

              cleanedPosts.push(...batchCleanPosts);

              logger.info(
                `Đã làm sạch và thêm ${batchCleanPosts.length} bài viết.`,
              );
            }
          } catch (parseError) {
            logger.error(
              "Lỗi khi parse batch GraphQL data:",
              parseError as any,
            );
          }
        }
      }

      const scrapeEndTime = Date.now();
      const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

      logger.info(`Thời gian bắt đầu: ${FormatVnTimeMsg(scrapeStartTime)}`);
      logger.info(`Thời gian kết thúc: ${FormatVnTimeMsg(scrapeEndTime)}`);
      logger.info(
        `Tổng thời gian thu thập dữ liệu: ${(scrapeDurationInMs / 1000).toFixed(2)} giây.`,
      );

      var scrapePerformanceContextInfo: ScrapePerformanceContextParams = {
        scrapeStartTime,
        scrapeEndTime,
        scrapeDurationInMs,
      };

      var scrapeResult: ScrapeResultParams = {
        scrapePerformance: scrapePerformanceContextInfo,
        scrapeData: cleanedPosts,
      };

      return scrapeResult as ScrapeResultParams;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        logger.info("Hoàn thành, đóng kết nối trình duyệt");
        await browser.disconnect();
      }
    }
  }

  private async switchCommentsViewMode(page: Page) {
    try {
      const triggerBtnXPath =
        "//div[@role='button'][@aria-haspopup='menu'][.//span[contains(text(), 'Most relevant')]]";
      const menuOptionXPath =
        "//div[@role='menuitem']//span[contains(text(), 'All comments')]";

      // 2. Check "Most relevant" button exist
      const triggerButton = await page
        .waitForSelector(`xpath/${triggerBtnXPath}`, { timeout: 3000 })
        .catch(() => null);

      if (triggerButton) {
        console.log(
          "Found 'Most relevant' filter. Switching to 'All comments'...",
        );
        await triggerButton.click();

        const allCommentsOption = await page.waitForSelector(
          `xpath/${menuOptionXPath}`,
          { visible: true, timeout: 5000 },
        );
        if (allCommentsOption) {
          await allCommentsOption.click();
          await page.waitForSelector(
            "xpath///div[@role='button'][.//span[contains(text(), 'All comments')]]",
            { timeout: 5000 },
          );
          console.log("Successfully switched to 'All comments'.");
        }
      } else {
        console.log("Filter is already 'All comments' or button not found.");
      }
    } catch (error) {
      console.error("Error switching comment filter:", error);
    }
  }

  public async sendToGoServer(
    projectId: string,
    data: ScrapeResultParams,
    token: string,
  ) {
    logger.info(
      `🚀 Bắt đầu gửi ${data.scrapeData.length} batch dữ liệu tới server Golang...`,
    );
    try {
      const response = await fetch(
        `${process.env.DATA_PIPELINE_SERVER_PARENT_ENDPOINT}/${process.env.DATA_PIPELINE_SERVER_CHILD_ENDPOINT}/${projectId}/scraping/facebook/group/process-data`,
        {
          method: HTTP_POST_METHOD,
          headers: {
            "Content-Type": API_CONTENT_TYPE,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data, null, 2),
        },
      );

      if (!response.ok) {
        throw new Error(`Server Golang phản hồi lỗi: ${response.statusText}`);
      }

      const result = await response.json();
      // await fs.writeFile(`facebook_group_posts_processed.json`, JSON.stringify(result, null, 2), "utf-8");
      logger.info("✅ Đã xử lý và ghi file từ server Golang thành công!");
      return result;
    } catch (error) {
      logger.error("❌ Lỗi khi gửi dữ liệu tới Golang:");
      throw error;
    }
  }
}

//   logger.info(`Bắt đầu chuyển ${rawDataAfterFetched.length} bài đăng dưới dạng dữ liệu RAW tới server Golang...`);

//   var data: any = [];
//   if (rawDataAfterFetched.length > 0) {
//     const BATCH_SIZE = 100;
//     const batches = [];
//     for (let i = 0; i < rawDataAfterFetched.length; i += BATCH_SIZE) {
//         batches.push(rawDataAfterFetched.slice(i, i + BATCH_SIZE));
//     }

//     const sendPromises = batches.map(batch => {
//         const batchResult: ScrapeResultParams = {
//             scrapePerformance: scrapePerformanceContextInfo,
//             scrapeData: batch,
//         };
//         return this.sendToGoServer(projectId, batchResult, token);
//     });

//     try {
//         // Sending batches parallel
//         const responses = await Promise.all(sendPromises);
//         console.log("✅ All batches processed successfully!");
//         data.push(...responses);
//     } catch (error) {
//         console.error("An error occurred while sending batches:", error);
//     }
// }
// scrapeResult.scrapeData = data;
