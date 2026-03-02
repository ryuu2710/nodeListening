import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { inject, injectable } from "tsyringe";
import { promises as fs } from "fs";
import pino from "pino";
import {
  API_CONTENT_TYPE,
  CDP_NETWORK_ENABLE_TO_SEND,
  DEBUG_ENV,
  FB_DEFAULT_ENDPOINT,
  FB_ENDPOINT_GROUP_KEY,
  FB_FANPAGE_COMMENT_API_REQUEST_FRIENDLY_NAME,
  FB_GROUP_API_REQUEST_FRIENDLY_NAME,
  FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME,
  FB_GROUP_COMMENT_API_REQUEST_FRIENDLY_NAME,
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
import { Browser, CDPSession, ElementHandle, Page } from "puppeteer";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import {
  FacebookFetchOptions,
  ScrapePerformanceContextParams,
  ScrapeResultGenParams,
  ScrapeResultParams,
} from "#types/index.js";
import {
  BuildFbRequestOptionsForCallApi,
  BuildFbRequestOptionsForCallApi_V2,
  BuildFbRequestOptionsForCallApi_V3,
  extractAndDecodeFbCursor,
  extractGroupPageInfo,
  WaitNextGraphQL,
} from "#share/fb.js";
import {
  fetchAndProcessBatchGqlData,
  fetchAndProcessMainGqlData,
  getCookiesFromCurrentPage,
} from "#share/api.js";
import { FormatVnTimeMsg } from "#share/display.js";
import {
  CommentPageInfo,
  CommentsProcessingGraphqlResult,
  SocialFbComment,
  SocialFbMention,
} from "./fb.types";
import {
  extractCommentFromRawJson,
  extractFanpagePostsFromRawJson,
  extractPageInfoOfComments,
  extractPostsFromRawJson,
  normalizeFacebookPost,
} from "./fb.clean";
import { buildFbGroupSearchUrl } from "./fb.builder";
import { logger } from "#share/logger.js";
import { result } from "lodash";
import { rabbitMQService } from "#share/rabbitmq.js";
import { batch } from "googleapis/build/src/apis/batch";
import { ScrapedPostMessage } from "#types/rabbitmq.js";

puppeteerExtra.use(StealthPlugin());

@injectable()
export default class FbScraperService {
  constructor() {}

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
        const processedBatchFbData = await fetchAndProcessMainGqlData(
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

  // Scrape Group Posts From Discussion Feed
  public async scrapeGroupPostsFromDiscussionFeed(
    groupURL: string,
    numberOfPosts: number | 20,
    topicId: string,
    trackerId: string
  ): Promise<SocialFbMention[]> {
    let browser: Browser | null = null;

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      const client: CDPSession = await this.setupScrapingEnviroment(page);

      logger.info(`Navigating to ${groupURL}`);

      await page.goto(groupURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      // scroll to capture GraphQL
      this.humanScroll(page);

      const { headers, bodyRaw } = await WaitNextGraphQL(
        client,
        FB_GROUP_API_REQUEST_FRIENDLY_NAME,
      );
      logger.info(
        `Capture Graphql Request '${FB_GROUP_API_REQUEST_FRIENDLY_NAME}'`,
      );

      const cookieStr = await getCookiesFromCurrentPage(page);

      // paginate group posts via api
      const cleanedPosts: SocialFbMention[] =
        await this.paginateGroupDiscussionFeedViaAPI(
          headers,
          bodyRaw,
          cookieStr,
          numberOfPosts,
          topicId, 
          trackerId
        );
      logger.info("📊 Final Total Collected Posts: " + cleanedPosts.length);

      return cleanedPosts;
    } catch (error) {
      console.error("Error in scrapeGroupPosts:", error);
      return [];
    } finally {
      if (browser) {
        await browser.disconnect();
      }
    }
  }

  // paginateGroupDiscussionFeedViaAPI
  private async paginateGroupDiscussionFeedViaAPI(
    header: Record<string, string>,
    body: string,
    cookie: string,
    MAX_COUNT_POSTS: number,
    topicId: string,
    trackerId: string,
  ): Promise<SocialFbMention[]> {
    let countPosts = 0;
    let hasNextPage: boolean = true;
    let currentCursor: string | null = null;
    const cleanedPosts: SocialFbMention[] = [];

    await rabbitMQService.connect();

    while (countPosts < MAX_COUNT_POSTS && hasNextPage) {
      logger.info(`🚀 Processing Batch... (Current count: ${countPosts})`);

      const fbRequestOptionsBuilderForCallApi: FacebookFetchOptions =
        await BuildFbRequestOptionsForCallApi_V3(
          header,
          body,
          cookie,
          currentCursor,
        );

      const batchGqlArr: any[] = await fetchAndProcessBatchGqlData(
        fbRequestOptionsBuilderForCallApi,
        logger,
      );
      if (!batchGqlArr || batchGqlArr.length === 0) {
        logger.warn("⚠️ No data received from API. Stop loop!");
        break;
      }
      const chunkEdges = batchGqlArr[0];
      console.log(chunkEdges);
      try {
        const jsonData =
          typeof chunkEdges === "string" ? JSON.parse(chunkEdges) : chunkEdges;

        const edges = jsonData?.data?.node?.group_feed?.edges || [];
        if (Array.isArray(edges)) {
          const batchCleanPosts = edges
            .map((edge: any) => normalizeFacebookPost(edge.node))
            .filter((post): post is SocialFbMention => post !== null); // Lọc null

          for (const post of batchCleanPosts) {
            const messagePayload: ScrapedPostMessage = {
              topicId,
              trackerId,
              platform: "FACEBOOK_GROUP",
              contentType: "POST",
              sourceUniqueId: post.id,
              socialUrl: post.url,
              authorName: post.authorMock?.name || "Unknown",
              authorId: post.authorMock?.id || "Unknown",
              authorUrl: post.author?.url || "Unknown",
              content: post.content || "",
              publishedAt:
                post.publishedAt.toISOString() || new Date().toISOString(),
              platformData: {
                likes: post.stats?.likes || 0,
                comments: post.stats?.comments || 0,
                shares: post.stats?.shares || 0,
                url: post.url,
              },
              scrapedAt: new Date().toISOString(),
            };

            console.log(messagePayload);

            const isSent = await rabbitMQService.publishScrapingData(messagePayload);
            if (isSent) {
              logger.debug(`📤 Pushed data of post [${post.id}] into RabbitMQ.`);
            } else {
              logger.error(
                `❌ Push Post [${post.id}] fail. Need backup storage!`,
              );
            }
          }

          const trackerPayload = {
            trackerId: '33333333-3333-3333-3333-333333333333',
            lastCursor: currentCursor,
            status: 'COMPLETED',
            scrapedAt: new Date().toISOString()
          };

          const isTrackerSent = await rabbitMQService.publishTrackerUpdate(trackerPayload);
          if (isTrackerSent) {
            logger.info(`📬 Cursor update report has been submitted. [${currentCursor?.substring(0, 10)}...] to Java successfully.`);
          } else {
            logger.error(`⚠️ Cursor report failed! The next attempt may repeat the same problem.`);
          }

          cleanedPosts.push(...batchCleanPosts);

          countPosts += batchCleanPosts.length;
          logger.info(`✅ Found new ${batchCleanPosts.length} posts.`);
        }
      } catch (parseError) {
        logger.error("Error when parsing batch GraphQL data:", parseError as any);
      }

      logger.info("Current Posts Length: " + cleanedPosts.length);

      const pageInfoChunk = batchGqlArr.find((chunk) => chunk?.data?.page_info);
      const validPageInfo = pageInfoChunk?.data?.page_info;

      if (validPageInfo && validPageInfo.end_cursor) {
        if (validPageInfo.end_cursor === currentCursor) {
          logger.warn("🛑 FB returns the exact same Cursor as the previous loop. Break the loop!");
          break;
        }
        currentCursor = validPageInfo.end_cursor;
        hasNextPage = validPageInfo.has_next_page;
        // logger.info(`🔑 Bắt được Cursor mới: ${currentCursor.substring(0, 15)}...`);
      } else {
        logger.warn("🛑 No page_info found in the returned array. Stop scratching!");
        break;
      }

      logger.info(
        `📊 Current total Collected: ${countPosts}/${MAX_COUNT_POSTS} posts.`,
      );

      // chill delay avoid rate limiting from fb
      if (hasNextPage && countPosts < MAX_COUNT_POSTS) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return cleanedPosts;
  }

  /**
   * Check Fanpage is verified or not?.
   */
  public async checkIsFanpageVerified(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
      const verifyKeywords = [
        "Verified account",
        "Tài khoản đã xác minh",
        "Đã xác minh",
        "Verified",
      ];

      const h1 = document.querySelector("h1");
      if (!h1) return false;
      const headerContainer =
        h1.closest('div[role="main"]') ||
        h1.parentElement?.parentElement ||
        document.body;
      const svgs = headerContainer.querySelectorAll("svg");

      for (const svg of svgs) {
        const titleTag = svg.querySelector("title");
        if (titleTag && titleTag.textContent) {
          if (verifyKeywords.includes(titleTag.textContent)) return true;
        }

        const titleAttr = svg.getAttribute("title");
        if (titleAttr && verifyKeywords.includes(titleAttr)) return true;

        const ariaLabel = svg.getAttribute("aria-label");
        if (ariaLabel && verifyKeywords.includes(ariaLabel)) return true;
      }

      return false;
    });
  }

  public async scrapeFanpagePosts(
    targetURL: string,
    sinceDate: Date,
  ): Promise<SocialFbMention[]> {
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

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

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

      while (isKeepScrolling) {
        const networkRacePromise = Promise.race([
          WaitNextGraphQL(
            client,
            FB_USER_PROFILE_API_REQUEST_FRIENDLY_NAME,
          ).then((res) => ({
            status: "SUCCESS",
            data: res,
          })),
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
          logger.warn(
            `Scroll Timeout (${timeoutCount}/${MAX_TIMEOUT_RETRIES}). No new data.`,
          );

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
        const processedBatchFbData = await fetchAndProcessMainGqlData(
          fbRequestOptionsBuilderForCallApi,
          logger,
        );

        if (processedBatchFbData) {
          const jsonData =
            typeof processedBatchFbData === "string"
              ? JSON.parse(processedBatchFbData)
              : processedBatchFbData;
          const batchPosts = extractFanpagePostsFromRawJson(
            jsonData,
            isVerified,
          );

          if (batchPosts.length > 0) {
            const validPosts = batchPosts.filter((post) => {
              return post.publishedAt >= sinceDate;
            });
            cleanedPosts.push(...validPosts);
            logger.info(`Collected ${validPosts.length} posts from batch.`);

            const lastPostInBatch = batchPosts[batchPosts.length - 1];
            if (lastPostInBatch && lastPostInBatch.publishedAt < sinceDate) {
              logger.info(
                `Found post from ${lastPostInBatch.publishedAt.toISOString()} which is older than ${sinceDate.toISOString()}. Stopping.`,
              );
              isKeepScrolling = false;
            }
          } else {
            logger.warn("Batch has no edges (might be empty feed unit).");
          }
        }
      }
    } catch (error) {
      logger.error("Error scraping fanpage:", error as any);
    } finally {
      if (browser) {
        browser.disconnect();
      }
    }

    return cleanedPosts;
  }

  public async scrapeCommentsOfPostInGroup(
    targetURL: string,
    postId?: string,
  ): Promise<SocialFbComment[]> {
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();
    const cleanedComments: SocialFbComment[] = [];

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

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

      for (let i = 0; i < 5; i++) {
        const networkPromises = Promise.race([
          WaitNextGraphQL(
            client,
            FB_GROUP_COMMENT_API_REQUEST_FRIENDLY_NAME,
          ).then((res) => ({
            status: "SUCCESS",
            data: res,
          })),
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
        logger.info(`Captured ${FB_GROUP_COMMENT_API_REQUEST_FRIENDLY_NAME}`);

        const cookieStr = await getCookiesFromCurrentPage(page);
        const fbRequestOptions = await BuildFbRequestOptionsForCallApi(
          headers,
          bodyRaw,
          cookieStr,
        );
        const processedBatchData = await fetchAndProcessMainGqlData(
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

            logger.info(`Cleaned comment batch successfully.`);

            // Parse to json dto
            const batchComments: SocialFbComment[] = extractCommentFromRawJson(
              jsonData,
              postId,
            );
            batchComments.map((data) => cleanedComments.push(data));
          } catch (parseError) {
            console.error("Error parsing GraphQL data:", parseError);
          }
        }
      }

      logger.info(`Collected ${cleanedComments.length} comments`);
      return cleanedComments;
    } catch (error) {
      console.error("Error in scrapeCommentsOfPost:", error);
      return [];
    } finally {
      if (browser) {
        await browser.disconnect();
      }
    }
  }

  // scrape comments of post in fanpage
  public async scrapeCommentsOfPostInFanpage(
    targetURL: string,
    postId?: string,
  ): Promise<SocialFbComment[]> {
    let browser: Browser | null = null;

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      const client: CDPSession = await this.setupScrapingEnviroment(page);

      await page.goto(targetURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      // toggle button from "Most Relevant" -> "All Comments"
      this.switchCommentsViewMode(page);

      // capture graphql and extract header/body
      const { headerRaw, bodyRaw } = await this.captureBootstrapPayload(
        page,
        client,
        "CommentsListComponentsPaginationQuery",
      );

      // paginated all comments
      const cleanedComments: SocialFbComment[] =
        await this.paginatedAllComments(headerRaw, bodyRaw, page, postId);

      return cleanedComments;
    } catch (error) {
      console.error("Error in scrapeCommentsOfPost:", error);
      return [];
    } finally {
      if (browser) {
        await browser.disconnect();
      }
    }
  }

  public async scrapeCommentsOfReelInFanpage(
    targetURL: string,
  ): Promise<SocialFbComment[]> {
    let browser: Browser | null = null;
    const scrapeStartTime = Date.now();
    const cleanedComments: SocialFbComment[] = [];

    // Open browser
    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

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

      const commentButtonSelector = 'div[aria-label="Comment"][role="button"]';
      await page.waitForSelector(commentButtonSelector, { visible: true });

      await page.evaluate((selector) => {
        const btn = document.querySelector(selector) as HTMLElement;
        if (btn) btn.click();
      }, commentButtonSelector);

      await new Promise((r) => setTimeout(r, 2000));

      // toggle button from "Most Relevant" -> "All Comments"
      const filterBtnSelector =
        'xpath///div[@role="button"]//span[contains(text(), "Most relevant")]';
      const allCommentsOptionSelector =
        'xpath///div[@role="menuitem"]//span[contains(text(), "All comments")]';

      try {
        const filterBtnHandle = await page.waitForSelector(filterBtnSelector, {
          timeout: 10000,
        });
        if (filterBtnHandle) {
          await filterBtnHandle.click();
          logger.info("Bot clicked Filter button. Waiting menu pop down...");

          // Waiting option "All Comments" option occur
          const allCommentsHandle = await page.waitForSelector(
            allCommentsOptionSelector,
            { timeout: 5000 },
          );

          if (allCommentsHandle) {
            await allCommentsHandle.click();
            logger.info("Switching 'All comments' button successfully.");
          }
        }
      } catch (innerError) {
        logger.warn(
          "[Error]: 'Filter' button not found or this Reel setup default state 'All comments'.",
        );
      }
      const viewMoreSelector =
        'xpath///div[@role="button"]//span[contains(text(), "View more comments")]';
      const commentContainerSelector = 'div[role="complementary"]';

      // for (let i = 0; i < 5; i++) {
      let loopCount = 0;
      const MAX_PAGINATION_LOOPS = 100;
      let isLoadingMore = true;

      while (isLoadingMore && loopCount < MAX_PAGINATION_LOOPS) {
        loopCount++;
        try {
          const container = await page.$(commentContainerSelector);
          const scrollDialog = async (
            container: ElementHandle<HTMLDivElement> | null,
          ) => {
            if (container) {
              await page.evaluate((el) => {
                if (el) {
                  el.scrollTop = el.scrollHeight;
                }
              }, container);

              await new Promise((r) => setTimeout(r, 1000));
            }
          };

          // scroll dialog
          await scrollDialog(container);

          const viewMoreCommentBtn = await page.waitForSelector(
            viewMoreSelector,
            { visible: true, timeout: 5000 },
          );
          if (viewMoreCommentBtn) {
            const networkPromises = Promise.race([
              WaitNextGraphQL(
                client,
                "CommentsListComponentsPaginationQuery",
              ).then((res) => ({
                status: "SUCCESS",
                data: res,
              })),
              new Promise((resolve) =>
                setTimeout(
                  () => resolve({ status: "TIMEOUT", data: null }),
                  5000,
                ),
              ),
            ]);
            await viewMoreCommentBtn.click();
            await new Promise((r) => setTimeout(r, 1000));
            logger.info(`Clicked 'View more' ${loopCount + 1} time`);

            const result = (await networkPromises) as {
              status: string;
              data: any;
            };
            if (result.status === "TIMEOUT" || !result.data) {
              console.warn(
                `Loop ${loopCount + 1}: No new GraphQL request captured (Timeout).`,
              );
              continue;
            }

            const { headers, bodyRaw } = result.data;
            logger.info(
              `Captured ${FB_GROUP_COMMENT_API_REQUEST_FRIENDLY_NAME}`,
            );

            await scrollDialog(container);

            const cookieStr = await getCookiesFromCurrentPage(page);
            const fbRequestOptions = await BuildFbRequestOptionsForCallApi(
              headers,
              bodyRaw,
              cookieStr,
            );
            const processedBatchData = await fetchAndProcessMainGqlData(
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

                logger.info(`Cleaned comment batch successfully.`);

                // Parse to json dto
                const batchComments: SocialFbComment[] =
                  extractCommentFromRawJson(
                    jsonData,
                    "", // postId
                  );
                batchComments.map((data) => cleanedComments.push(data));
              } catch (parseError) {
                console.error("Error parsing GraphQL data:", parseError);
              }
            }
          } else {
            logger.info("Not see 'View more', done loading all comments.");
            isLoadingMore = false;
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Waiting for selector")
          ) {
            logger.info(
              "✅ No more 'View more comments' button found. Pagination finished.",
            );
          } else {
            logger.error({
              message: `❌ Unexpected error in loop ${loopCount}:`,
              error,
            });
          }

          // Dừng vòng lặp
          isLoadingMore = false;
        }
      }
      logger.info(`Collected ${cleanedComments.length} comments`);
      return cleanedComments;
    } catch (error) {
      console.error("Error in scrapeCommentsOfPost:", error);
      return [];
    } finally {
      if (browser) {
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
        logger.info(
          "Found 'Most relevant' filter. Switching to 'All comments'...",
        );

        // await triggerButton.click();
        await page.evaluate((el) => (el as HTMLElement).click(), triggerButton);

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
          logger.info("Successfully switched to 'All comments'.");
        }
      } else {
        logger.info("Filter is already 'All comments' or button not found.");
      }
    } catch (error) {
      console.error("Error switching comment filter:", error);
    }
  }

  private async switchCommentsViewModeInReelVideo(page: Page) {}

  // setup scraping environment
  private async setupScrapingEnviroment(page: Page): Promise<CDPSession> {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

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

    // set the viewport of browser
    await page.setViewport({
      width: 0,
      height: 0,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    });

    return client;
  }

  // capture payload of graphql
  private async captureBootstrapPayload(
    page: Page,
    client: CDPSession,
    fbApiFriendlyName: string,
  ): Promise<{ headerRaw: string; bodyRaw: string }> {
    await new Promise((r) => setTimeout(r, 1500));

    const switchTrapPromise = Promise.race([
      WaitNextGraphQL(client, fbApiFriendlyName).then((res) => ({
        status: "SUCCESS",
        data: res,
      })),
      new Promise((resolve) =>
        setTimeout(() => resolve({ status: "TIMEOUT", data: null }), 5000),
      ),
    ]);

    await page.evaluate(async () => {
      const dialog = document.querySelector('div[role="dialog"]');
      let target = dialog as HTMLElement;

      if (dialog) {
        const scrollableChild = Array.from(dialog.querySelectorAll("*")).find(
          (el) => {
            const e = el as HTMLElement;
            const style = window.getComputedStyle(e);
            return (
              e.scrollHeight > e.clientHeight &&
              ["auto", "scroll"].includes(style.overflowY)
            );
          },
        );
        if (scrollableChild) target = scrollableChild as HTMLElement;
      } else {
        target = document.documentElement;
      }

      target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });

      await new Promise((resolve) => setTimeout(resolve, 800));

      target.scrollTop = target.scrollHeight - 10;
      await new Promise((resolve) => setTimeout(resolve, 100));
      target.scrollTop = target.scrollHeight;
    });

    const switchResult = (await switchTrapPromise) as {
      status: string;
      data: any;
    };

    if (switchResult.status === "TIMEOUT" || !switchResult.data) {
      throw new Error("Không bắt được gói tin khởi tạo GraphQL");
    }

    return {
      headerRaw: switchResult.data.headers,
      bodyRaw: switchResult.data.bodyRaw,
    };
  }

  // paginated all comments
  private async paginatedAllComments(
    headerRaw: string,
    bodyRaw: string,
    currentPage: Page,
    postId?: string,
    nextCursor?: string,
  ) {
    const processGraphQLData = async (
      headers: any,
      bodyRaw: string,
      currentPage: Page,
      nextCursor?: string,
    ) => {
      logger.info(`Captured ${FB_FANPAGE_COMMENT_API_REQUEST_FRIENDLY_NAME}`);

      const cookieStr = await getCookiesFromCurrentPage(currentPage);
      const fbRequestOptions = await BuildFbRequestOptionsForCallApi_V2(
        headers,
        bodyRaw,
        cookieStr,
        nextCursor,
      );
      const processedBatchData = await fetchAndProcessMainGqlData(
        fbRequestOptions,
        logger,
      );

      let commentsResult: CommentsProcessingGraphqlResult = {
        comments: [],
        hasNextPage: false,
        endCursor: null,
      };

      if (processedBatchData) {
        try {
          const jsonData =
            typeof processedBatchData === "string"
              ? JSON.parse(processedBatchData)
              : processedBatchData;

          const batchComments: SocialFbComment[] = extractCommentFromRawJson(
            jsonData,
            postId,
          );

          commentsResult.comments = batchComments;

          // extract page info
          const pageInfo: CommentPageInfo = extractPageInfoOfComments(jsonData);
          commentsResult.hasNextPage = pageInfo.hasNextPage;
          commentsResult.endCursor = pageInfo.endCursor;
        } catch (parseError) {
          console.error("Error parsing GraphQL data:", parseError);
        }
      }

      return commentsResult;
    };

    const cleanedComments: SocialFbComment[] = [];
    let currentCommentsResult: CommentsProcessingGraphqlResult =
      await processGraphQLData(headerRaw, bodyRaw, currentPage);

    currentCommentsResult.comments.forEach((c) => cleanedComments.push(c));

    let loopCount = 1;
    const MAX_API_LOOPS = 20;

    console.log("Has next page: ", currentCommentsResult.hasNextPage);

    while (
      currentCommentsResult.hasNextPage &&
      currentCommentsResult.endCursor &&
      loopCount < MAX_API_LOOPS
    ) {
      logger.info(`[API Request ${loopCount}] Fetching next comments using cursor:
            ${currentCommentsResult.endCursor.substring(0, 15)}...`);

      currentCommentsResult = await processGraphQLData(
        headerRaw,
        bodyRaw,
        currentPage,
        currentCommentsResult.endCursor,
      );

      currentCommentsResult.comments.forEach((c) => cleanedComments.push(c));
      loopCount++;

      // prevent rate limit from Facebook
      await new Promise((r) => setTimeout(r, 500));
    }

    logger.info(
      `Finished API Pagination. Total loops: ${loopCount}. Total comments: ${cleanedComments.length}`,
    );

    return cleanedComments;
  }

  private async humanScroll(page: Page) {
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
      logger.info("Scroll error ignored");
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
//         logger.info("✅ All batches processed successfully!");
//         data.push(...responses);
//     } catch (error) {
//         console.error("An error occurred while sending batches:", error);
//     }
// }
// scrapeResult.scrapeData = data;
