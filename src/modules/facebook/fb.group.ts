import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { promises as fs } from "fs";
import { FacebookFetchOptions, ScrapePerformanceContextParams, ScrapeResultParams } from "../../types";
import { BuildFbRequestOptionsForCallApi, WaitNextGraphQL } from "../../share/fb";
import { Browser, Page } from "puppeteer";
import {
  DEBUG_ENV,
  FB_DEFAULT_ENDPOINT,
  FB_ENDPOINT_GROUP_KEY,
  FB_GROUP_API_REQUEST_FRIENDLY_NAME,
  INFO_ENV,
  PRODUCTION_ENV,
  CDP_NETWORK_ENABLE_TO_SEND,
  PPT_REQUEST_KEY,
  PPT_TIMEOUT_DEFAULT,
  PPT_WAIT_UNTIL_DEFAULT,
  QUERY_PARAMS_RECENT_ACTIVITY,
  TEN,
  THREE,
  API_CONTENT_TYPE,
  HTTP_POST_METHOD,
  TWENTY,
  FIFTY,
  ONE_HUNDRED,
} from "../../constants";
import pino from "pino";
import { fetchAndProcessBatchGqlData, getCookiesFromCurrentPage } from "#share/api.js";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import { FormatVnTimeMsg } from "#share/display.js";

const groupIds = [107054892693732, 579052783828776, 1166454660883635, 2188989274602898, "xaykenh4.0", "kienthuctaichinhkinhte", 1992548960760601, "youneverwatchedthismovie"];
const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

puppeteerExtra.use(StealthPlugin());

(async () => {
  // Remote Debugging
  const browser: Browser = await getMyCustomRemoteBrowser();
  const page: Page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on(PPT_REQUEST_KEY, (req) => req.continue());

  // Open CDP Network domain to get postData fallback
  const client = await page.target().createCDPSession();
  await client.send(CDP_NETWORK_ENABLE_TO_SEND);
  await page.goto(`${FB_DEFAULT_ENDPOINT}/${FB_ENDPOINT_GROUP_KEY}/${groupIds[groupIds.length - 2]}?${QUERY_PARAMS_RECENT_ACTIVITY}`, {
    waitUntil: PPT_WAIT_UNTIL_DEFAULT,
    timeout: PPT_TIMEOUT_DEFAULT,
  });

  const SCROLL_TIMES = ONE_HUNDRED;
  const rawDataAfterFetched: string[] = [];
  var scrapeStartTime = Date.now();

  for (let i = 0; i < SCROLL_TIMES; i++) {
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight });
    });

    const { headers, bodyRaw } = await WaitNextGraphQL(client, FB_GROUP_API_REQUEST_FRIENDLY_NAME);
    logger.info(`✅ Bắt được request '${FB_GROUP_API_REQUEST_FRIENDLY_NAME}'`);

    const cookieStr = await getCookiesFromCurrentPage(page);
    const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions = await BuildFbRequestOptionsForCallApi(headers, bodyRaw, cookieStr);
    const processedBatchFbData = await fetchAndProcessBatchGqlData(fbRequestOptionsBuilderForCallApi, logger);

    if (processedBatchFbData) {
      rawDataAfterFetched.push(processedBatchFbData);
    }
  }

  const scrapeEndTime = Date.now();
  const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

  logger.info(`✅ Đã thu thập xong ${rawDataAfterFetched.length} batch bài viết dưới dạng Raw Json.`);
  logger.info(`Thời gian bắt đầu: ${FormatVnTimeMsg(scrapeStartTime)}`);
  logger.info(`Thời gian kết thúc: ${FormatVnTimeMsg(scrapeEndTime)}`);
  logger.info(`Tổng thời gian thu thập dữ liệu: ${(scrapeDurationInMs / 1000).toFixed(2)} giây.`);

  logger.info({
    scrapeStartTime,
    scrapeEndTime,
    scrapeDurationInMs,
  });

  var scrapePerformanceContextInfo: ScrapePerformanceContextParams = {
    scrapeStartTime,
    scrapeEndTime,
    scrapeDurationInMs,
  };

  var scrapeResultParams: ScrapeResultParams = {
    scrapePerformance: scrapePerformanceContextInfo,
    scrapeData: rawDataAfterFetched,
  };


  logger.info("🎉 Hoàn thành tất cả các lần cuộn. Đóng trình duyệt.");
  await browser.disconnect();
})();

// fs.writeFile(`facebook_group_posts.json`, JSON.stringify(allPosts, null, 2), "utf-8");

  // fs.writeFile(`facebook_group_posts.json`, JSON.stringify(rawDataAfterFetched, null, 2), "utf-8");
  // logger.info(`🚀 Bắt đầu chuyển ${rawDataAfterFetched.length} bài đăng dưới dạng dữ liệu RAW tới server Golang...`);

  // try {
  //   const response = await fetch(
  //     `${process.env.DATA_PIPELINE_SERVER_PARENT_ENDPOINT}/${process.env.DATA_PIPELINE_SERVER_CHILD_ENDPOINT}/process-group-posts`,
  //     {
  //       method: HTTP_POST_METHOD,
  //       headers: {
  //         "Content-Type": API_CONTENT_TYPE,
  //       },
  //       body: JSON.stringify(scrapeResultParams, null, 4),
  //     },
  //   );

  //   if (!response.ok) {
  //     throw new Error(`Server Golang phản hồi lỗi: ${response.statusText}`);
  //   }

  //   const result = await response.json();
  //   try {
  //     const dataToWrite = JSON.stringify(result, null, 2);
  //     await fs.writeFile(`facebook_group_posts_processed.json`, dataToWrite, "utf-8");
  //     logger.info("✅ Đã ghi file thành công!");
  //   } catch (error) {
  //     logger.error("❌ Đã xảy ra lỗi khi ghi file:");
  //   }
  // } catch (error) {
  //   logger.error("❌ Lỗi khi gửi dữ liệu tới Golang:");
  // }
