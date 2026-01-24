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
import { FacebookFetchOptions, ScrapePerformanceContextParams, ScrapeResultGenParams, ScrapeResultParams } from "#types/index.js";
import { BuildFbRequestOptionsForCallApi, WaitNextGraphQL } from "#share/fb.js";
import { fetchAndProcessBatchGqlData, getCookiesFromCurrentPage } from "#share/api.js";
import { FormatVnTimeMsg } from "#share/display.js";
import { SocialFbMention } from "./fb.types";
import { extractPostsFromRawJson, normalizeFacebookPost } from "./fb.clean";
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
          const toggleSelector = 'input[role="switch"][aria-label="Recent Posts"]';
          const toggleInput = await page.waitForSelector(toggleSelector, { timeout: 5000 }).catch(() => null);

          if (toggleInput) {
            const isChecked = await toggleInput.evaluate((el) => el.getAttribute("aria-checked") === "true");

            if (!isChecked) {
              logger.info("The button is currently DISABLED. Click to turn it on...");
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
          logger.warn("Error when using the Recent Posts button (Skip to continue):", e as any);
        }
      }

      for (let i = 0; i < scrollTimes; i++) {
        const networkRacePromise = Promise.race([
          WaitNextGraphQL(client, FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME).then((res) => ({ status: "SUCCESS", data: res })),
          new Promise((resolve) => setTimeout(() => resolve({ status: "TIMEOUT", data: null }), 10000)),
        ]);

        await this.humanScroll(page);

        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        });

        const result = (await networkRacePromise) as { status: string; data: any };

        if (result.status === "TIMEOUT") {
          logger.warn(`Scroll ${i + 1}: Timeout - no data found.`);
          break;
        }

        const {headers, bodyRaw} = result.data;
        logger.info(`Snapshot request '${FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME}'`);

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions = await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
        const processedBatchFbData = await fetchAndProcessBatchGqlData(fbRequestOptionsBuilderForCallApi, logger);

        if (processedBatchFbData) {
          try {
            const jsonData = typeof processedBatchFbData === "string" ? JSON.parse(processedBatchFbData) : processedBatchFbData;
            const rawStoriesAccessor = extractPostsFromRawJson(jsonData);

            if (rawStoriesAccessor.length > 0) {
              const batchCleanPosts = rawStoriesAccessor
                .map((story: any) => normalizeFacebookPost(story))
                .filter((post): post is SocialFbMention => post !== null);
              cleanedPosts.push(...batchCleanPosts);
              logger.info(`Cleaned and added the ${batchCleanPosts.length} posts.`);
              await page.evaluate(() => {
                window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
              });
            }
          } catch (parseError) {
            logger.error("Error parsing batch GraphQL data:", parseError as any);
          }
        }

        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        });
      }

      const scrapeEndTime = Date.now();
      const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

      logger.info(`Start time scraping: ${FormatVnTimeMsg(scrapeStartTime)}`);
      logger.info(`End time scraping: ${FormatVnTimeMsg(scrapeEndTime)}`);
      logger.info(`Total data collection time: ${(scrapeDurationInMs / 1000).toFixed(2)} seconds.`);

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
            finalProcessingMs: 0
          }
        },
        count: cleanedPosts.length,
        data: cleanedPosts
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

        const { headers, bodyRaw } = await WaitNextGraphQL(client, FB_GROUP_API_REQUEST_FRIENDLY_NAME);
        logger.info(`Bắt được request '${FB_GROUP_API_REQUEST_FRIENDLY_NAME}'`);

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions = await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
        const processedBatchFbData = await fetchAndProcessBatchGqlData(fbRequestOptionsBuilderForCallApi, logger);

        if (processedBatchFbData) {
          try {
            const jsonData = typeof processedBatchFbData === "string" ? JSON.parse(processedBatchFbData) : processedBatchFbData;

            const edges = jsonData?.data?.node?.group_feed?.edges || [];
            if (Array.isArray(edges)) {
              const batchCleanPosts = edges
                .map((edge: any) => normalizeFacebookPost(edge.node))
                .filter((post): post is SocialFbMention => post !== null); // Lọc null

              cleanedPosts.push(...batchCleanPosts);

              logger.info(`Đã làm sạch và thêm ${batchCleanPosts.length} bài viết.`);
            }
          } catch (parseError) {
            logger.error("Lỗi khi parse batch GraphQL data:", parseError as any);
          }
        }
      }

      const scrapeEndTime = Date.now();
      const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

      logger.info(`Thời gian bắt đầu: ${FormatVnTimeMsg(scrapeStartTime)}`);
      logger.info(`Thời gian kết thúc: ${FormatVnTimeMsg(scrapeEndTime)}`);
      logger.info(`Tổng thời gian thu thập dữ liệu: ${(scrapeDurationInMs / 1000).toFixed(2)} giây.`);

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

  public async sendToGoServer(projectId: string, data: ScrapeResultParams, token: string) {
    logger.info(`🚀 Bắt đầu gửi ${data.scrapeData.length} batch dữ liệu tới server Golang...`);
    try {
      const response = await fetch(
        `${process.env.DATA_PIPELINE_SERVER_PARENT_ENDPOINT}/${process.env.DATA_PIPELINE_SERVER_CHILD_ENDPOINT}/${projectId}/scraping/facebook/group/process-data`,
        {
          method: HTTP_POST_METHOD,
          headers: { "Content-Type": API_CONTENT_TYPE, Authorization: `Bearer ${token}` },
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

//   logger.info(`✅ 🚀 Bắt đầu chuyển ${rawDataAfterFetched.length} bài đăng dưới dạng dữ liệu RAW tới server Golang...`);

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
