import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { inject, injectable } from "tsyringe";
import pino from "pino";
import {
  CAMEL_CATEGORY_KEY,
  CAMEL_LOCALE_KEY,
  CAMEL_MANUFACTURER_KEY,
  CAMEL_PRODUCT_GROUP_KEY,
  DEBUG_ENV,
  DOM_CONTENT_LOADED_KEY,
  FilterProductAttributesFromUrl,
  INFO_ENV,
  NUMBER_OF_REQUIRED_SCRAPING_FOR_AMAZON_PRODUCT,
  PPT_TIMEOUT_DEFAULT,
  PPT_WAIT_UNTIL_DEFAULT,
  PRODUCTION_ENV,
  PUPPETEER_EXTRA_HTTP_HEADER_ACCEPT_LANGUAGE_VALUE,
  PUPPETEER_USER_AGENT,
} from "#constants/index.js";
import { Browser, ElementHandle, Page } from "puppeteer";
import { delay, getMyCustomRemoteBrowser } from "#share/browser.js";
import { filterAsinFromUrl, filterLocationAndDateOfFeedbackItem } from "#share/filter.js";
import { mapCamelDataToPriceHistoryJson } from "#share/mapper.js";
import {
  AmazonFeedbackDTO,
  AmazonScrapeResultParams,
  AmazonProductDTO,
  ScrapedCamelData,
  ScrapedProductBasicInfoDto,
  ScrapeResultGenParams,
  SearchResultItem,
} from "#types/index.js";
import { AmazonHtmlSelectorManager } from "#constants/class+id.constants.js";
import { retrieveCamelSpecificationByKey } from "#share/eval.js";
import { parseAmazonPrice, parseHelpfulCount } from "#share/parse.js";
import pLimit, { LimitFunction } from "p-limit";
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import { GoogleSheetService } from "./google-sheet.service";
import { GOOGLE_SHEET_AMAZON_PRODUCTS_HEADERS, GOOGLE_SHEET_AMAZON_PRODUCTS_SHEET_NAMES } from "#constants/google-sheet.constants.js";
import PuppeteerUtils from "#share/puppeteer-utils.js";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

puppeteerExtra.use(StealthPlugin());

const SPREADSHEET_ID = "1MSui6cXsAN46zMZbUH_lYVpkllZA7TN4_B5PiEF52W0";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@injectable()
export default class AmazonScraperService {
  private sheetsApi;

  constructor(@inject(GoogleSheetService) private readonly googleSheetService: GoogleSheetService) {
    this.sheetsApi = this.googleSheetService.getClient();
  }

  public async scrapeAggregateProductsBySearchKw(keyword: string, maxPages: number): Promise<ScrapeResultGenParams<AmazonProductDTO>[]> {
    // Step 1. Setup the amazon browser
    let amazonBrowser: Browser | null = null;
    let amazonPage: Page | null = null;
    const scrapeStartTime = Date.now();
    let allData: AmazonScrapeResultParams[] = [];
    let allSearchResults: SearchResultItem[] = [];
    let currentPageNum = 1;
    let currentUrl = `https://www.amazon.com/s?k=${keyword}`;

    try {
      amazonBrowser = await getMyCustomRemoteBrowser();
      amazonPage = await amazonBrowser.newPage();
      let url: string = `https://www.amazon.com/s?k=${keyword}`;
      await amazonPage.goto(url, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      await amazonPage.setViewport({ width: 1920, height: 1080 });

      while (currentPageNum <= maxPages) {
        logger.info(`Đang cào trang tìm kiếm số ${currentPageNum}: ${currentUrl}`);

        await amazonPage.waitForSelector("div[data-component-type='s-search-result']", { visible: true, timeout: 15000 });

        let resultsOnThisPage: SearchResultItem[] = await amazonPage.$$eval("div[data-component-type='s-search-result'][data-asin]", (resultDivs) => {
          return resultDivs
            .map((div) => {
              const asin = div.getAttribute("data-asin");
              if (!asin) return null;

              const isAdHolder = div.classList.contains("AdHolder");

              // Check kỹ hơn bằng link dẫn (phòng hờ class AdHolder bị đổi)
              let isSspaLink: boolean = false;
              const linkTag = div.querySelector("a.a-link-normal");
              if (linkTag) {
                const href = linkTag.getAttribute("href") || "";
                if (href.includes("/sspa/")) isSspaLink = true;
              }

              return {
                asin: asin,
                url: `https://www.amazon.com/dp/${asin}`,
                isSponsored: isAdHolder || isSspaLink, // True nếu thoả mãn 1 trong 2
              };
            })
            .filter((item): item is SearchResultItem => item !== null);
        });

        allSearchResults.push(...resultsOnThisPage);
        logger.info(`-> Tìm thấy ${resultsOnThisPage.length} sản phẩm ở trang ${currentPageNum}. Tổng hiện tại: ${allSearchResults.length}`);

        await amazonPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        if (currentPageNum >= maxPages) {
          logger.info("Đã đạt giới hạn số trang (maxPages). Dừng pagination.");
          break;
        }

        const nextSelector = "a.s-pagination-item.s-pagination-next";

        await amazonPage.waitForSelector(nextSelector, { visible: true });

        let nextButton = await amazonPage.$(nextSelector);

        if (!nextButton) {
          logger.warn("Selector Class không thấy, thử tìm bằng Text...");
          const buttons = await amazonPage.$$eval("a", (elements) =>
            elements
              .filter((el) => el.textContent?.includes("Next"))
              .map(() => true)
          );
          if (buttons.length > 0) {
            nextButton = await amazonPage.$("a:has-text('Next')");
          }
        }

        if (!nextButton) {
          logger.info("Nút Next không tồn tại. Kết thúc pagination.");
          break;
        }

        const nextHref = await amazonPage.evaluate((el) => el?.getAttribute("href"), nextButton);
        const isDisabled = await amazonPage.evaluate((el) => el?.classList.contains("s-pagination-disabled"), nextButton);

        if (isDisabled || !nextHref) {
          logger.info("Nút Next bị disabled hoặc không có link. Kết thúc pagination.");
          break;
        }

        currentUrl = `https://www.amazon.com${nextHref}`;
        currentPageNum++;

        // Human behavior
        const randomDelay = 2000 + Math.random() * 2000;
        await new Promise((r) => setTimeout(r, randomDelay));
      }
      logger.info(`Thu thập xong tổng cộng ${allSearchResults.length} sản phẩm từ ${currentPageNum} trang.`);

      await amazonPage.close();
      amazonPage = null;

      const concurrencyLimit = 1;
      const limit: LimitFunction = pLimit(concurrencyLimit);

      logger.info(`Chuẩn bị cào chi tiết với ${concurrencyLimit} luồng...`);
      // searchResults = searchResults.slice(0, NUMBER_OF_REQUIRED_SCRAPING_FOR_AMAZON_PRODUCT);

      const uniqueSearchResults = Array.from(
        new Map(allSearchResults.map(item => [item.asin, item])).values()
      );

      const scrapePromises = uniqueSearchResults.map((item) => {
        return limit(async () => {
          try {
            const result: ScrapeResultGenParams<AmazonProductDTO> = await this.scrapeAmazonProductDetails(amazonBrowser, item.url);
            if (result && result.data) {
              result.data.isSponsored = item.isSponsored;
              result.data.url = item.url;
            }
            return result;
          } catch (err: any) {
            logger.error({ message: `Failed to scrape product ASIN: ${item.asin}`, error: err.message });
            return null;
          }
        });
      });

      const results: (ScrapeResultGenParams<AmazonProductDTO> | null)[] = await Promise.all(scrapePromises);
      const finalData: ScrapeResultGenParams<AmazonProductDTO>[] = results.filter(
        (data): data is ScrapeResultGenParams<AmazonProductDTO> => data !== null,
      );

      logger.info(`Hoàn tất cào. Thành công: ${finalData.length}/${uniqueSearchResults.length}`);
      return finalData;
    } catch (error) {
      logger.error({ message: "Lỗi ở trang Amazon (aggregate): ", error });
      return allData;
    } finally {
      if (amazonPage) {
        try {
          await amazonPage.close();
        } catch (err) {}
      }
    }
  }

  public async sendToGoServer(projectId: string, data: ScrapeResultGenParams<AmazonProductDTO>[]) {
    logger.info(`🚀 Bắt đầu gửi ${data} batch dữ liệu tới server Golang...`);
  }

  /**
   * Orchestrates the complete scraping lifecycle for a single Amazon product by aggregating data from multiple sources.
   *
   * **Logic Flow:**
   * 1. **Anti-Bot Prep:** Injects a random delay (1-4s) and configures User-Agents/Headers to bypass Amazon WAF.
   * 2. **Parallel Fetching:** Scrapes basic metadata and pricing simultaneously to reduce execution time.
   * 3. **External Data:** Fetches historical pricing from CamelCamelCamel using the discovered ASIN.
   * 4. **Navigation:** Navigates to the "Reviews/Feedback" sub-page to scrape user sentiment.
   * 5. **Assembly:** Merges all data into a `AmazonProductDTO` and calculates performance metrics.
   *
   * @param amazonBrowser - The Puppeteer Browser instance.
   * - **Senior Tip:** Pass an existing browser instance to enable **Connection Pooling** and reduce CPU overhead.
   * - If `null` is passed, a new isolated remote browser connection is created (heavier resource usage).
   * @param url - The target Amazon product URL.
   *
   * @returns {Promise<ScrapeResultGenParams<AmazonProductDTO>>} A promise resolving to the fully hydrated product data and performance timings.
   *
   * @throws {Error} Propagates any Puppeteer navigation errors (Timeouts, Selector Failures) after logging them.
   *
   * @remarks
   * **Resource Management Critical Warning:**
   * This function guarantees the closure of the `amazonPage` in the `finally` block.
   * If you modify this, ensure the `page.close()` remains in `finally` to prevent **Memory Leaks** (Zombie Chrome tabs)
   * which will crash the server under load.
   */
  public async scrapeAmazonProductDetails(amazonBrowser: Browser | null, url: string): Promise<ScrapeResultGenParams<AmazonProductDTO>> {
    // Step 1. Setup the amazon browser
    // let amazonBrowser: Browser | null = null;
    let amazonPage: Page | null = null;
    const scrapeStartTime = Date.now();

    try {
      const randomDelay = 1000 + Math.random() * 3000;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      if (!amazonBrowser) {
        // If no browser was passed in, create a new remote browser instance.
        amazonBrowser = await getMyCustomRemoteBrowser();
      }

      amazonPage = await amazonBrowser.newPage();
      await amazonPage.goto(url, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: 300000,
      });

      await amazonPage.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await amazonPage.setUserAgent(PUPPETEER_USER_AGENT);

      // Step 2. Scrape base product info
      /**
       * TODO: ======================== Scrape the main data of the products on Amazon Site ========================== */
      /** NOTE - Base info  */

      const [productBaseInfo, productBasePrice] = await Promise.all([
        this.scrapeBasicInfo(amazonPage, url),
        this.scrapeAmazonPriceAsNumeric(amazonPage),
      ]);

      const mainProductScrapeEnd = Date.now();

      // Step 3. Setup and access to the Camel browser
      /** TODO: ======================== Scrape CAMEL page ========================== */
      const camelData = await this.scrapeCamelData(amazonBrowser, productBaseInfo.asin || "");
      const camelScrapeEnd = Date.now();

      // Step 4. Get the feedbacks of products on Amazon Site
      // const feedbackButtonSelector: string = AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackButtonSelector;
      // await amazonPage.waitForSelector(feedbackButtonSelector, { visible: true, timeout: 60000 });
      // await Promise.all([amazonPage.click(feedbackButtonSelector), amazonPage.waitForNavigation({ waitUntil: DOM_CONTENT_LOADED_KEY })]);

      // let refinedFeedbackArr: AmazonFeedbackDTO[] = await this.scrapeAllFeedbacks(amazonPage);
      const feedbackScrapeEnd = Date.now();

      // Step 5. Processed and return completed data
      const productDto: AmazonProductDTO = {
        asin: productBaseInfo.asin ?? "",
        title: productBaseInfo.title,
        availability: productBaseInfo.availability,
        brand: productBaseInfo.brand || "Unknown Brand",
        ratingStars: productBaseInfo.ratingStars,
        totalPurchasedRating: productBaseInfo.totalPurchasedRating,
        retailerName: productBaseInfo.retailerName,
        isAmazonChoice: productBaseInfo.isAmazonChoice,
        isBestSeller: productBaseInfo.isBestSeller,
        isSponsored: false,
        marketVolume: productBaseInfo.marketVolume,
        bestSellerRanks: productBaseInfo.bestSellerRanks,
        extra: {
          category: camelData.extra.category ?? "",
          manufacturer: camelData.extra.manufacturer ?? "",
          productGroup: camelData.extra.productGroup ?? "",
          locale: camelData.extra.locale ?? "",
        },
        currentPriceOnAmazonSite: productBasePrice,
        priceHistory: camelData.history,
        feedbacks: [],
        url,
      };

      const scrapeEndTime: number = Date.now();
      const finalPerformance = {
        totalDurationMs: scrapeEndTime - scrapeStartTime,
        breakdown: {
          mainProductPageMs: mainProductScrapeEnd - scrapeStartTime,
          camelPageMs: camelScrapeEnd - mainProductScrapeEnd,
          feedbackPagesMs: feedbackScrapeEnd - camelScrapeEnd,
          finalProcessingMs: scrapeEndTime - feedbackScrapeEnd,
        },
      };
      logger.info({ message: `Hoàn tất cào dữ liệu cho ASIN: ${productBaseInfo.asin}`, performance: finalPerformance });
      const finalResult: ScrapeResultGenParams<AmazonProductDTO> = { performance: finalPerformance, data: productDto } as AmazonScrapeResultParams;
      return finalResult;
    } catch (error) {
      logger.error({ message: "Lỗi ở trang Amazon: ", error });
      const scrapeEndTime = Date.now();
      logger.error({
        message: `Scraping thất bại cho URL: ${url}`,
        durationMs: scrapeEndTime - scrapeStartTime,
        error,
      });
      throw error;
    } finally {
      if (amazonPage) {
        logger.info("Hoàn thành, đóng kết nối trình duyệt AMAZON");
        await amazonPage.close();
      }
    }
  }

  /**
   * Extracts the "Best Sellers Rank" hierarchy from the product details table on the current page.
   *
   * **Scraping Strategy:**
   * 1. **Anchor Finding:** Locates the specific `<th>` containing the text "Best Sellers Rank".
   * 2. **Sibling Traversal:** Navigates to the immediate sibling `<td>` to find the associated data container.
   * 3. **Text Parsing:** Iterates through list items and uses Regex to separate the numeric rank from the category name.
   *
   * @param currentPage - The active Puppeteer Page instance positioned at the product details section.
   *
   * @returns {Promise<Array<{ rank: string; categoryMarket: string }>>}
   * An array of ranking objects (e.g., `[{ rank: "1,204", categoryMarket: "Kitchen & Dining" }]`).
   * Returns an empty array `[]` if the section is missing or the DOM structure has changed.
   *
   * @remarks
   * **Senior Tip - The "Sandbox" Rule:**
   * This function uses `page.evaluate()`. Remember that the code inside the callback runs **inside the Chrome Browser Context**, not in your Node.js process.
   * - You cannot access variables defined outside the evaluate function (unless passed as args).
   * - `console.log` inside evaluate will print to the Browser Console, not your Terminal (unless piped).
   *
   * **Maintenance Warning:**
   * This logic relies on `nextElementSibling`. If Amazon wraps the text in a `div` or changes the table structure, this selector will break.
   * Validates against Regex: `/#([\d,]+)\s+in\s+(.*?)(?:\s+\(|\s*$)/`
   */
  public async scrapeBestSellerRank(currentPage: Page) {
    const bestSellerRanks = await currentPage.evaluate(() => {
      const allThs = Array.from(document.querySelectorAll("th.prodDetSectionEntry"));
      const rankTh = allThs.find((th) => th.textContent?.trim() === "Best Sellers Rank");

      if (!rankTh) {
        return [];
      }

      const rankTd = rankTh.nextElementSibling;
      if (!rankTd) {
        return [];
      }

      const rankListItems = Array.from(rankTd.querySelectorAll("li .a-list-item"));
      const ranks = rankListItems
        .map((item) => {
          const text = item.textContent || "";
          const regex = /#([\d,]+)\s+in\s+(.*?)(?:\s+\(|\s*$)/;
          const match = text.match(regex);

          if (match && match.length >= 3) {
            return {
              rank: match[1],
              categoryMarket: match[2].trim(),
            };
          }
          return null;
        })
        .filter((item): item is { rank: string; categoryMarket: string } => item !== null);

      return ranks;
    });

    return bestSellerRanks;
  }

  /**
   * Iteratively scrapes *all* customer reviews by handling pagination automatically.
   *
   * **Logic Flow:**
   * 1. **Looping Strategy:** Enters a `while` loop that continues as long as a "Next Page" button is detected.
   * 2. **Batch Extraction (`$$eval`):** Extracts raw data for all reviews on the current page in a single execution context (Browser-side).
   * 3. **Hydration (Node-side):** detailed parsing (date splitting, helpful count logic) happens back in the Node process to keep the browser function lightweight.
   * 4. **Pagination:** Clicks "Next" and waits for navigation, introducing a slight artificial delay to mimic human reading speed.
   *
   * @param currentPage - The Puppeteer Page instance, currently positioned at the first page of the review section.
   *
   * @returns {Promise<AmazonFeedbackDTO[]>} An accumulated array of all reviews found across all pages.
   *
   * @remarks
   * **Senior Tip - Performance Optimization (RTT):**
   * We use `page.$$eval` instead of looping through elements with `page.$` and calling `getProperty` repeatedly.
   * - **Why?** `$$eval` runs the loop *inside* Chrome and returns a single JSON array.
   * - **Benefit:** This avoids hundreds of "Round Trips" between Node.js and the Browser Protocol, making the scrape 10x-50x faster.
   *
   * **Senior Tip - Serialization Context:**
   * Notice we pass the `selectors` object as the second argument to `$$eval`.
   * The function inside `$$eval` cannot see variables defined in this class (variable closure doesn't work across the process boundary).
   *
   * **Production Warning - Infinite Loops:**
   * Currently, this loop relies solely on the "Next" button presence.
   * In a strict production environment, you should add a `maxPages` safety break (e.g., `if (pageCount > 50) break;`)
   * to prevent getting stuck in a scraping trap if the UI bugs out or the list is infinite.
   */
  public async scrapeAllFeedbacks(currentPage: Page): Promise<AmazonFeedbackDTO[]> {
    let allFeedback: AmazonFeedbackDTO[] = [];
    let hasNextPage: boolean = true;

    while (hasNextPage) {
      logger.info(`Đang thu thập dữ liệu từ trang: ${await currentPage.url()}`);
      const feedbackListSelector = AmazonHtmlSelectorManager.product.compoundsManager.feedbackListSelector;
      await currentPage.waitForSelector(feedbackListSelector, { visible: true });

      const selectors = {
        username: AmazonHtmlSelectorManager.product.compoundsManager.feedbackDetails.usernameSelector,
        rating: AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackDetails.ratingSelector,
        title: AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackDetails.titleSelector,
        description: AmazonHtmlSelectorManager.product.compoundsManager.feedbackDetails.feedbackDescriptionSelector,
        localeAndDate: AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackDetails.localeAndDateComponentSelector,
        verifiedPurchase: AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackDetails.verifiedPurchaseSelector,
        helpfulCount: AmazonHtmlSelectorManager.product.dataHookSelectorManager.feedbackDetails.helpfulCountSelector,
      };

      type TempFeedbackPayload = {
        username: string;
        feedbackTitle: string;
        feedbackDescription: string;
        feedbackRating: number;
        feedbackLocaleText: string;
        isVerifiedPurchase: boolean;
        helpfulCountText: string;
      };

      const tempFeedbackListArrOnThisPage: TempFeedbackPayload[] = await currentPage.$$eval(
        feedbackListSelector,
        (feedbackList, sel) => {
          return feedbackList.map((feedback) => {
            // Username
            const username = feedback.querySelector(sel.username)?.textContent || "";

            // Rating
            const ratingElement = feedback.querySelector(sel.rating);
            let feedbackRating = 0;
            if (ratingElement) {
              // Dùng regex để trích xuất số từ class "a-star-5"
              const ratingMatch = ratingElement.className.match(/\ba-star-(\d)\b/);
              if (ratingMatch) {
                feedbackRating = parseInt(ratingMatch[1], 10);
              }
            }

            // Title
            const titleElement = feedback.querySelector(sel.title);
            const feedbackTitle = titleElement ? titleElement.textContent.trim() : "";

            // Descriptions
            const feedbackDescription = feedback.querySelector(sel.description)?.textContent || "";

            // Location & Date
            const feedbackLocaleText = feedback.querySelector(sel.localeAndDate)?.textContent || "";

            // Verified Purchase
            let isVerifiedPurchaseText: string = "";
            let isVerifiedPurchase: boolean = false;

            try {
              isVerifiedPurchaseText = feedback.querySelector(sel.verifiedPurchase)?.textContent.trim() || "";
              if (isVerifiedPurchaseText !== "") {
                isVerifiedPurchase = true;
              }
            } catch (error) {
              console.error(`Lỗi query thẻ ${sel.verifiedPurchase}: `, error);
            }

            // Helpful Count
            let helpfulCountText: string = "";

            try {
              helpfulCountText = feedback.querySelector(sel.helpfulCount)?.textContent ?? "";
            } catch (error) {
              console.error(`Lỗi query thẻ ${sel.helpfulCount}: `, error);
            }
            const tempFeedbackPayload: TempFeedbackPayload = {
              username,
              feedbackTitle,
              feedbackDescription,
              feedbackRating,
              feedbackLocaleText,
              isVerifiedPurchase,
              helpfulCountText,
            };
            return tempFeedbackPayload;
          });
        },
        selectors,
      );

      // Processed feedback list
      const refinedFeedbackArr: AmazonFeedbackDTO[] = tempFeedbackListArrOnThisPage.map((rawFeedback) => {
        const [country, date] = filterLocationAndDateOfFeedbackItem(rawFeedback.feedbackLocaleText);
        const parsedHelpfulCount = parseHelpfulCount(rawFeedback.helpfulCountText);
        const refinedObject: AmazonFeedbackDTO = {
          username: rawFeedback.username || "unknown member",
          title: rawFeedback.feedbackTitle,
          description: rawFeedback.feedbackDescription || "",
          rating: rawFeedback.feedbackRating || 0,
          onCountry: country,
          creationTimeAsString: date,
          isVerifiedPurchase: rawFeedback.isVerifiedPurchase,
          helpfulCount: parsedHelpfulCount,
        };
        return refinedObject;
      });

      allFeedback.push(...refinedFeedbackArr);
      logger.info(`Đã lấy được ${refinedFeedbackArr.length} reviews. Tổng số: ${allFeedback.length}`);

      // Tracking next page button
      const nextPageButtonSelector = AmazonHtmlSelectorManager.product.compoundsManager.button.nextPage;
      const nextPageButton = await currentPage.$(nextPageButtonSelector);

      if (nextPageButton) {
        logger.info("Tìm thấy trang tiếp theo, đang điều hướng...");
        await Promise.all([currentPage.click(nextPageButtonSelector), currentPage.waitForNavigation({ waitUntil: DOM_CONTENT_LOADED_KEY })]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } else {
        logger.info("Đây là trang cuối cùng. Hoàn tất thu thập.");
        hasNextPage = false;
      }
    }

    return allFeedback;
  }

  /**
   * Scrapes historical price data and metadata from an auxiliary source (CamelCamelCamel).
   *
   * **Logic Flow & "Competitive Racing":**
   * 1. **Default Initialization:** Prepares a "Null Object" structure to ensure the return value is always valid, even on failure.
   * 2. **Navigation:** Visits the CamelCamelCamel URL for the specific ASIN.
   * 3. **The Race Strategy (`Promise.race`):** Instead of waiting for the table and timing out if it's missing, we race two selectors:
   * - Selector A: The Price Table (Success).
   * - Selector B: The "Not Found" text (Failure).
   * - Whichever appears first dictates the logic flow, saving massive amounts of timeout waiting time.
   * 4. **Parallel Extraction:** Fetches metadata keys (Category, Manufacturer) in parallel to minimize idle CPU time.
   *
   * @param browser - The Puppeteer Browser instance.
   * @param asin - The Amazon Standard Identification Number. If empty, returns default data immediately.
   *
   * @returns {Promise<ScrapedCamelData>}
   * A guaranteed object structure.
   * - If scraping succeeds: Populated with history and metadata.
   * - If scraping fails/times out/ASIN not found: Returns a default object with "null" strings and 0 values.
   *
   * @remarks
   * **Senior Tip - Fail-Safe Design:**
   * This function uses a **"Swallow Error"** strategy (`catch` logs but doesn't re-throw).
   * - **Why?** CamelCamelCamel is a 3rd party tool. It might be down, blocked, or missing the ASIN.
   * - **Impact:** We explicitly do *not* want the main Amazon scraping job to fail just because this auxiliary data is missing.
   *
   * **Senior Tip - The Null Object Pattern:**
   * Notice we initialize `result` at the top. This prevents `undefined` errors in the UI or backend services that consume this data.
   * Always prefer returning a "Safe Empty Object" over returning `null` or `undefined` for DTOs.
   */
  private async scrapeCamelData(browser: Browser, asin: string): Promise<ScrapedCamelData> {
    if (asin === "") {
      return {
        history: {
          lowestPrice: {
            latestDate: "",
            value: 0,
          },
          highestPrice: {
            latestDate: "",
            value: 0,
          },
          currentPrice: {
            latestDate: "",
            value: 0,
          },
          averagePrice: 0,
        },
        extra: {
          category: "null",
          manufacturer: "null",
          productGroup: "null",
          locale: "null",
        },
      };
    }
    let camelPage: Page | null = null;

    // 1. Khởi tạo giá trị mặc định (Default Values)
    // Để đảm bảo hàm luôn trả về đúng cấu trúc, tránh lỗi "Cannot read property of null"
    const result: ScrapedCamelData = {
      history: {
        lowestPrice: {
          latestDate: "",
          value: 0,
        },
        highestPrice: {
          latestDate: "",
          value: 0,
        },
        currentPrice: {
          latestDate: "",
          value: 0,
        },
        averagePrice: 0,
      },
      extra: {
        category: "null",
        manufacturer: "null",
        productGroup: "null",
        locale: "null",
      },
    };

    try {
      camelPage = await browser.newPage();
      await camelPage.setExtraHTTPHeaders({
        PUPPETEER_EXTRA_HTTP_HEADER_ACCEPT_LANGUAGE_KEY: PUPPETEER_EXTRA_HTTP_HEADER_ACCEPT_LANGUAGE_VALUE,
      });

      const camelUrl = `${process.env.CAMEL_DOMAIN}/${asin}?cpf=amazon`;
      logger.info(`[Camel] Đang điều hướng tới: ${camelUrl}`);
      await camelPage.goto(camelUrl, { waitUntil: PPT_WAIT_UNTIL_DEFAULT, timeout: 60000 });

      // 2. "COMPETITIVE RACING" Strategy
      const tableSelector = AmazonHtmlSelectorManager.product.classSelectorsManager.camelSite.rawTableBodySelector;

      // Selector tìm text "not yet in our database" (Dùng ::-p-text nếu puppeteer mới, hoặc XPath)
      const notFoundSelector = "::-p-text('product is not yet in our database')";
      const errorSelector = "//*[contains(text(), '500 Internal Server Error') or contains(text(), 'Please unblock challenges')]"

      const raceResult = await Promise.race([
        camelPage.waitForSelector(tableSelector, { visible: true, timeout: 20000 }).then(() => "SUCCESS"),
        camelPage.waitForSelector(notFoundSelector, { visible: true, timeout: 20000 }).then(() => "NOT_FOUND"),
        camelPage.waitForSelector(errorSelector, { visible: true, timeout: 20000 }).then(() => "CLOUDFARE_SERVER_ERROR"),
      ]).catch(() => "TIMEOUT");

      // === 3. XỬ LÝ KẾT QUẢ ĐUA ===

      if (raceResult === "CLOUDFARE_SERVER_ERROR") {
        logger.warn(`[Camel] Gặp lỗi 500 Internal Server Error (Cloudflare) tại sản phẩm có mã ASIN <${asin}>. Skip.`);
        return result;
      }

      if (raceResult === "NOT_FOUND") {
        logger.warn(`[Camel] Sản phẩm ${asin} chưa có trong Database của hệ thống Camel. Bỏ qua.`);
        return result;
      }

      if (raceResult === "TIMEOUT") {
        logger.warn(`[Camel] Timeout/Captcha tại ${asin}. Không lấy được dữ liệu.`);
        return result;
      }

      await camelPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      const rawCamelPriceBodyParams: string[] = await camelPage.$$eval(tableSelector, (options) => {
        return options.map((option) => option.textContent).map((text) => text?.trim().replace(/\s*\n$/, "") || "");
      });

      result.history = mapCamelDataToPriceHistoryJson(rawCamelPriceBodyParams, "3rd Party New");

      // 4.2. Lấy Extra Data (Chạy song song để tối ưu thời gian)
      // Thay vì await từng cái (mất 4x thời gian), ta await tất cả cùng lúc
      const [category, manufacturer, productGroup, locale] = await Promise.all([
        retrieveCamelSpecificationByKey(camelPage, CAMEL_CATEGORY_KEY).catch(() => null),
        retrieveCamelSpecificationByKey(camelPage, CAMEL_MANUFACTURER_KEY).catch(() => null),
        retrieveCamelSpecificationByKey(camelPage, CAMEL_PRODUCT_GROUP_KEY).catch(() => null),
        retrieveCamelSpecificationByKey(camelPage, CAMEL_LOCALE_KEY).catch(() => null),
      ]);

      result.extra = {
        category: category || "",
        manufacturer: manufacturer || "",
        productGroup: productGroup || "",
        locale: locale || "",
      };

      if (result.extra.category) {
        logger.info(`[Camel] Scrape thành công: ${asin} | Cat: ${result.extra.category}`);
      } else {
        logger.warn(`[Camel] Scrape được giá nhưng thiếu thông tin Extra cho ${asin}`);
      }
    } catch (error) {
      logger.error(`[Camel] Lỗi không mong muốn với ${asin}: ${error}`);
    } finally {
      // Luôn đóng page để giải phóng RAM
      if (camelPage) {
        await camelPage.close();
      }
    }

    return result;
  }

  /**
   * Aggregates the fundamental metadata of a product (Title, Brand, Ratings) in a single parallel batch.
   *
   * **Logic Flow:**
   * 1. **Parallel Execution ("Scatter-Gather"):** Fires 6+ separate selector queries simultaneously using `Promise.all`.
   * 2. **URL Parsing:** Extracts the ASIN directly from the URL string rather than relying on the DOM (which is often hidden/dynamic).
   * 3. **Badge Detection:** Checks for the existence of specific elements (Amazon Choice) to determine boolean flags.
   *
   * @param page - The active Puppeteer Page instance.
   * @param url - The current URL (used for immutable ASIN extraction).
   *
   * @returns {Promise<ScrapedProductBasicInfoDto>} A flat object containing the raw strings/numbers of the product's core identity.
   *
   * @remarks
   * **Senior Tip - Concurrency & Latency:**
   * We use `Promise.all` instead of `await`ing each field line-by-line.
   * - **Sequential:** Time = T(title) + T(brand) + T(rating)... (~500ms total).
   * - **Parallel:** Time = Max(T(title), T(brand), T(rating)...) (~100ms total).
   * This is critical when scraping thousands of products.
   *
   * **Critical Warning - "Fail-Fast" Behavior:**
   * `Promise.all` has a "fail-fast" mechanism. If **any single** utility function inside the array throws an error (e.g., `retrieveTextFromSelector` crashes), the **entire function fails**.
   * *Ensure your `PuppeteerUtils` methods are "Safe Accessors"* (i.e., they return `""` or `null` on failure, rather than throwing exceptions).
   *
   * **Maintenance Note:**
   * Use `AmazonHtmlSelectorManager`. Amazon changes IDs/Classes weekly;
   * centralized selector management is the only way to keep the scraper maintainable.
   */
  private async scrapeBasicInfo(page: Page, url: string): Promise<ScrapedProductBasicInfoDto> {
    const selectorsManager = AmazonHtmlSelectorManager.product;
    const [title, availability, brand, ratingStars, marketVolumeText, retailerName] = await Promise.all([
      PuppeteerUtils.retrieveTextFromSelector(page, selectorsManager.idSelectorsManager.titleSelector),
      PuppeteerUtils.retrieveTextFromSelector(page, selectorsManager.compoundsManager.availability),
      PuppeteerUtils.retrieveTextFromSelector(page, selectorsManager.classSelectorsManager.brandSelector),
      PuppeteerUtils.retrieveTextFromSelector(page, selectorsManager.compoundsManager.totalRating),
      this.scrapeMarketVolume(page),
      this.scrapeRetailerName(page),
    ]);

    const asin = filterAsinFromUrl(url, FilterProductAttributesFromUrl.ASIN);
    const totalPurchasedRating = await PuppeteerUtils.retrieveNumberFromSelector(
      page,
      selectorsManager.idSelectorsManager.totalRatingFromPurchasedGroupSelector,
    );

    // Check Amazon Choice / Best Seller
    const isAmazonChoice = (await page.$(selectorsManager.compoundsManager.amazonChoiceSelector.join(", "))) !== null;

    // Best Seller Rank logic phức tạp nên giữ nguyên hàm cũ hoặc tách ra
    const bestSellerRanks = await this.scrapeBestSellerRank(page);
    const isBestSeller = bestSellerRanks.some((obj) => obj.rank === "1");
    return {
      asin,
      title,
      availability,
      brand,
      ratingStars,
      totalPurchasedRating,
      marketVolume: marketVolumeText,
      retailerName,
      isAmazonChoice,
      isBestSeller,
      bestSellerRanks,
    } as ScrapedProductBasicInfoDto;
  }

  /**
   * Safely extracts the "Sales Velocity" or "Social Proof" text (e.g., "2K+ bought in past month").
   *
   * **Scraping Strategy:**
   * 1. **Element Lookup:** Attempts to find the element handle using `page.$`.
   * 2. **Context Switch:** If found, switches context to the browser (`page.evaluate`) to read the text content.
   * 3. **Sanitization:** Trims whitespace to ensure clean database entry.
   *
   * @param page - The active Puppeteer Page instance.
   * @returns {Promise<string>} The raw text (e.g., "500+ bought in past month") or `""` if missing/error.
   *
   * @remarks
   * **Senior Tip - Non-Critical Data Handling:**
   * This function uses a "Swallow & Return Default" strategy.
   * Since "Market Volume" is often A/B tested by Amazon (sometimes hidden), we wrap the logic in a `try/catch`
   * and return an empty string rather than throwing an error. This ensures the main scraping job completes even if this specific badge is missing.
   *
   * **Refactoring Opportunity (Performance):**
   * Currently, this uses `page.$` followed by `evaluate`. This requires **two** protocol round-trips (Node -> Browser -> Node -> Browser -> Node).
   * *Optimization:* Switch to `page.$eval(selector, el => el.textContent)` to perform lookup and extraction in a **single** round-trip.
   */
  private async scrapeMarketVolume(page: Page): Promise<string> {
    const selector = AmazonHtmlSelectorManager.product.idSelectorsManager.marketVolumeSelector;
    try {
      const el = await page.$(selector);
      return el ? await page.evaluate((e) => e.textContent?.trim() || "", el) : "";
    } catch {
      return "";
    }
  }

  /**
   * Extracts the "Sold By" entity name from the Buy Box area (e.g., "Amazon.com" or "AnkerDirect").
   *
   * **Business Context:**
   * This data point is critical for distinguishing between:
   * - **1P (First-Party):** Sold directly by Amazon ("Amazon.com").
   * - **3P (Third-Party):** Sold by external merchants using FBA or FBM.
   *
   * @param page - The active Puppeteer Page instance.
   * @returns {Promise<string>} The retailer name (trimmed) or `""` if the Buy Box is missing/suppressed.
   *
   * @remarks
   * **Senior Tip - Code Quality (DRY Principle):**
   * You may notice this function body is *identical* to `scrapeMarketVolume` (except for the selector).
   * - **Bad Pattern:** Copy-pasting boilerplate logic (`try/catch`, `page.$`, `evaluate`).
   * - **Senior Fix:** Create a generic helper like `scrapeTextSafe(page, selector)` to handle the try-catch and extraction logic. This reduces technical debt and makes fixing bugs (like the `$eval` optimization) easier across the entire codebase.
   *
   * **Stability Warning:**
   * The "Buy Box" is the most dynamic part of Amazon's UI. It changes based on user location, stock levels, and A/B testing.
   * The `try/catch` here is essential because the "Sold By" line often disappears for out-of-stock items.
   */
  private async scrapeRetailerName(page: Page): Promise<string> {
    const selector = AmazonHtmlSelectorManager.product.idSelectorsManager.retailerSelector;
    try {
      const el = await page.$(selector);
      return el ? await page.evaluate((e) => e.textContent?.trim() || "", el) : "";
    } catch {
      return "";
    }
  }

  /**
   * extracting the "Buy Box" price (the main display price) as a standardized number.
   *
   * **Scraping Strategy:**
   * 1. **Targeting:** Focuses on the `.priceToPay` container, which usually holds the "current offer" price.
   * 2. **Fail-Fast:** Uses a short 5-second timeout. If the price isn't immediately available (e.g., "See price in cart", "Currently unavailable"), we abort early rather than waiting 30s.
   * 3. **Normalization:** Converts currency strings (e.g., "$1,200.50") into pure integers/floats for database math.
   *
   * @param amazonPage - The active Puppeteer Page instance.
   * @returns {Promise<number>} The price as a number. Returns `0` if the price is missing, hidden, or unavailable.
   *
   * @remarks
   * **Senior Code Review - Critical Bug:**
   * 🚨 **Variable Mismatch Detected:** The argument is named `amazonPage`, but the code inside uses `page.waitForSelector` and `PuppeteerUtils.retrieveTextFromSelector(page, ...)`.
   * Unless `page` is a global variable (which is bad practice), this code will throw a `ReferenceError` at runtime.
   * *Action:* Rename the usage inside the function to match the argument `amazonPage`.
   *
   * **Senior Tip - Data Modeling (0 vs Null):**
   * This function returns `0` on failure. Be careful with this in Analytics.
   * - If you calculate "Average Price", a `0` will incorrectly drag the average down.
   * - In strict systems, returning `null` (to indicate "No Data") is often safer than `0` (which implies "Free").
   *
   * **Senior Tip - Selector Specificity:**
   * The selector uses `span[aria-hidden='true']`. This is often the "Visual" price elements ($ + Whole + Fraction).
   * Note that Amazon sometimes puts the clean text in a `.a-offscreen` span instead. If this selector becomes flaky, check the "hidden" accessible text first.
   */
  private async scrapeAmazonPriceAsNumeric(page: Page): Promise<number> {
    const priceSelector = AmazonHtmlSelectorManager.product.compoundsManager.currentPriceOnAmazonSite;
    try {
      await page.waitForSelector(priceSelector, { timeout: 5000 });

      const priceText = await PuppeteerUtils.retrieveTextFromSelector(page, priceSelector);
      if (!priceText) return 0;

      const parsedNumericPrice: number = parseAmazonPrice(priceText);
      return parsedNumericPrice || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Xuất dữ liệu cào được ra file Excel với nhiều sheet đã được làm phẳng.
   * Đây là best practice để người dùng business/marketing có thể đọc và phân tích
   * dữ liệu dễ dàng bằng cách sử dụng các sheet riêng biệt cho sản phẩm,
   * feedbacks, và xếp hạng.
   *
   * @param productsData Mảng dữ liệu kết quả cào được.
   * @param outputFolder Thư mục để lưu file Excel.
   * @param fileName Tên file (ví dụ: 'bao_cao_san_pham.xlsx').
   */
  public async exportProductsToExcel(productsData: AmazonScrapeResultParams[], fileName: string): Promise<void> {
    const workbook = new (ExcelJS as any).Workbook();
    workbook.creator = "Volmjr Bot Scraper";
    workbook.lastModifiedBy = "Volmjr Bot Scraper";
    workbook.created = new Date();
    workbook.modified = new Date();

    // === 1. TẠO SHEET TỔNG QUAN SẢN PHẨM ===
    const productSheet = workbook.addWorksheet("Sản phẩm");
    const outputFolder = "/Users/nguyenphucloi/Desktop/Volmjr Data/amazon";

    productSheet.columns = [
      { header: "ASIN", key: "asin", width: 15 },
      { header: "Link sản phẩm", key: "link", width: 50 },
      { header: "Tiêu đề sản phẩm", key: "title", width: 50 },
      { header: "Thương hiệu", key: "brand", width: 25 },
      { header: "Nhà bán lẻ", key: "retailerName", width: 25 },
      { header: "Tình trạng kho", key: "availability", width: 20 },
      { header: "Điểm đánh giá (sao)", key: "ratingStars", width: 15, style: { numFmt: "0.0" } },
      { header: "Tổng lượt đánh giá", key: "totalPurchasedRating", width: 15 },
      { header: "Là Amazon Choice?", key: "isAmazonChoice", width: 15 },
      { header: "Là Best Seller?", key: "isBestSeller", width: 15 },
      { header: "Lượt mua tháng trước", key: "marketVolume", width: 20 },
      { header: "Danh mục (Camel)", key: "category", width: 20 },
      { header: "Tổng thời gian cào (giây)", key: "totalDurationSec", width: 15, style: { numFmt: "0.00" } },
      { header: "TG cào trang chính (giây)", key: "mainProductPageSec", width: 15, style: { numFmt: "0.00" } },
      { header: "TG cào Camel (giây)", key: "camelPageSec", width: 15, style: { numFmt: "0.00" } },
      { header: "TG cào Feedbacks (giây)", key: "feedbackPagesSec", width: 15, style: { numFmt: "0.00" } },
    ];

    // === 2. TẠO SHEET XẾP HẠNG BEST SELLER ===
    const rankSheet = workbook.addWorksheet("Xếp hạng Bestseller");
    rankSheet.columns = [
      { header: "ASIN", key: "asin", width: 15 },
      { header: "Thứ hạng", key: "rank", width: 15 },
      { header: "Danh mục", key: "categoryMarket", width: 40 },
    ];

    // === 3. TẠO SHEET CHI TIẾT FEEDBACKS ===
    const feedbackSheet = workbook.addWorksheet("Chi tiết Feedbacks");
    feedbackSheet.columns = [
      { header: "ASIN", key: "asin", width: 15 },
      { header: "Tên người dùng", key: "username", width: 25 },
      { header: "Điểm (sao)", key: "rating", width: 10 },
      { header: "Tiêu đề Feedback", key: "title", width: 40 },
      { header: "Nội dung Feedback", key: "description", width: 60 },
      { header: "Quốc gia", key: "onCountry", width: 20 },
      { header: "Ngày đăng", key: "creationTimeAsString", width: 25 },
      { header: "Đã xác minh?", key: "isVerifiedPurchase", width: 15 },
      { header: "Lượt hữu ích", key: "helpfulCount", width: 15 },
    ];

    // (Best Practice) Thêm style cho tất cả các hàng tiêu đề
    [productSheet, rankSheet, feedbackSheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0070C0" }, // Màu xanh đậm
      };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    });

    // === 4. ĐỔ DỮ LIỆU VÀO CÁC SHEET ===
    logger.info(`Bắt đầu xử lý ${productsData.length} sản phẩm để xuất Excel...`);

    for (const result of productsData) {
      const product = result.data;
      const perf = result.performance;

      // Thêm 1 hàng vào Sheet "Sản phẩm"
      productSheet.addRow({
        asin: product.asin,
        link: `https://www.amazon.com/dp/${product.asin}`,
        title: product.title,
        brand: product.brand,
        retailerName: product.retailerName,
        availability: product.availability,
        ratingStars: parseFloat(product.ratingStars) || 0,
        totalPurchasedRating: product.totalPurchasedRating,
        isAmazonChoice: product.isAmazonChoice,
        isBestSeller: product.isBestSeller,
        marketVolume: product.marketVolume,
        category: product.extra.category,
        totalDurationSec: perf.totalDurationMs / 1000,
        mainProductPageSec: perf.breakdown.mainProductPageMs / 1000,
        camelPageSec: perf.breakdown.camelPageMs / 1000,
        feedbackPagesSec: perf.breakdown.feedbackPagesMs / 1000,
      });

      // Thêm nhiều hàng vào Sheet "Xếp hạng Bestseller"
      for (const rank of product.bestSellerRanks) {
        rankSheet.addRow({
          asin: product.asin, // Dùng ASIN làm khóa chung
          rank: rank.rank,
          categoryMarket: rank.categoryMarket,
        });
      }

      // Thêm nhiều hàng vào Sheet "Chi tiết Feedbacks"
      for (const feedback of product.feedbacks) {
        feedbackSheet.addRow({
          asin: product.asin, // Dùng ASIN làm khóa chung
          username: feedback.username,
          rating: feedback.rating,
          title: feedback.title,
          description: feedback.description,
          onCountry: feedback.onCountry,
          creationTimeAsString: feedback.creationTimeAsString,
          isVerifiedPurchase: feedback.isVerifiedPurchase,
          helpfulCount: feedback.helpfulCount,
        });
      }
    }

    const fullPath = path.join(outputFolder, fileName);
    await fs.promises.mkdir(outputFolder, { recursive: true });
    await workbook.xlsx.writeFile(fullPath);

    logger.info(`Đã xuất file Excel thành công tại: ${fullPath}`);
  }

  /**
   * Làm phẳng và "thêm" (append) dữ liệu cào được vào Google Sheet (Workbook 1).
   * @param productsData Mảng kết quả cào được.
   */
  public async appendDataToGoogleSheet(productsData: ScrapeResultGenParams<AmazonProductDTO>[]): Promise<void> {
    logger.info(`Bắt đầu làm phẳng ${productsData.length} sản phẩm...`);
    const productRows: any[] = [];
    const feedbackRows: any[] = [];
    const rankRows: any[] = [];
    const performanceRows: any[] = [];
    const scrapeTime = new Date().toISOString();

    for (const result of productsData) {
      const product = result.data;
      const perf = result.performance;
      productRows.push([
        product.asin,
        product.title,
        product.brand,
        product.retailerName,
        product.availability,
        parseFloat(product.ratingStars) || 0,
        product.totalPurchasedRating,
        product.isAmazonChoice,
        product.isBestSeller,
        product.marketVolume,
        product.extra.category,
        scrapeTime,
      ]);
      for (const feedback of product.feedbacks) {
        feedbackRows.push([
          product.asin,
          feedback.username,
          feedback.rating,
          feedback.title,
          feedback.description,
          feedback.onCountry,
          feedback.creationTimeAsString,
          feedback.isVerifiedPurchase,
          feedback.helpfulCount,
        ]);
      }
      for (const rank of product.bestSellerRanks) {
        rankRows.push([product.asin, rank.rank, rank.categoryMarket]);
      }
      performanceRows.push([
        product.asin,
        scrapeTime,
        perf.totalDurationMs / 1000,
        perf.breakdown.mainProductPageMs / 1000,
        perf.breakdown.camelPageMs / 1000,
        perf.breakdown.feedbackPagesMs / 1000,
      ]);
    }

    logger.info("Đã làm phẳng xong. Bắt đầu ghi headers và định dạng...");

    // ✅ BƯỚC 3.1: Lấy Sheet ID từ Sheet Name (quan trọng)
    const sheetIdMap = await this.getSheetIds(SPREADSHEET_ID);

    // ✅ BƯỚC 3.2: Cập nhật giá trị headers (Phần này đã đúng)
    const updateHeaderValuesRequests = [
      this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Sản Phẩm!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [GOOGLE_SHEET_AMAZON_PRODUCTS_HEADERS.product] },
      }),
      this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Feedbacks!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [GOOGLE_SHEET_AMAZON_PRODUCTS_HEADERS.feedback] },
      }),
      this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Xếp Hạng!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [GOOGLE_SHEET_AMAZON_PRODUCTS_HEADERS.rank] },
      }),
      this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Hiệu suất!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [GOOGLE_SHEET_AMAZON_PRODUCTS_HEADERS.performance] },
      }),
    ];
    await Promise.all(updateHeaderValuesRequests);

    // ✅ BƯỚC 3.3: Tạo request định dạng (format) dùng sheetId
    const formatRequests = GOOGLE_SHEET_AMAZON_PRODUCTS_SHEET_NAMES.map((sheetName) => {
      const sheetId = sheetIdMap.get(sheetName); // Lấy ID
      if (sheetId === undefined) {
        logger.warn(`Không tìm thấy Sheet ID cho sheet: ${sheetName}. Bỏ qua định dạng.`);
        return null;
      }

      // Mảng chứa 2 request: 1 cho màu sắc, 1 cho đóng băng
      return [
        {
          repeatCell: {
            range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1 }, // Hàng 1
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.0, green: 0.439, blue: 0.753 }, // Xanh #0070C0
                textFormat: { foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              gridProperties: { frozenRowCount: 1 }, // Đóng băng Hàng 1
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ];
    })
      .filter((req) => req !== null)
      .flat(); // Lọc bỏ null và làm phẳng mảng

    // ✅ BƯỚC 3.4: Chạy batchUpdate để định dạng
    if (formatRequests.length > 0) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: formatRequests,
        },
      });
    }

    logger.info("Định dạng headers thành công. Bắt đầu thêm dữ liệu...");

    // === 4. THÊM DỮ LIỆU (Append) (Giữ nguyên) ===
    const appendDataRequests = [];
    if (productRows.length > 0) {
      appendDataRequests.push(
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Sản Phẩm!A:L",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: productRows },
        }),
      );
    }
    if (feedbackRows.length > 0) {
      appendDataRequests.push(
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Feedbacks!A:I",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: feedbackRows },
        }),
      );
    }
    if (rankRows.length > 0) {
      appendDataRequests.push(
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Xếp Hạng!A:C",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rankRows },
        }),
      );
    }
    if (performanceRows.length > 0) {
      appendDataRequests.push(
        this.sheetsApi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Hiệu suất!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: performanceRows },
        }),
      );
    }

    if (appendDataRequests.length > 0) {
      await Promise.all(appendDataRequests);
    }

    logger.info(`Đã ghi thành công ${productRows.length} sản phẩm vào Google Sheet.`);
  }

  /**
   * Lấy một Map(Tên Sheet => ID Sheet) từ Google Sheet.
   * Cần thiết cho các thao tác batchUpdate (định dạng).
   */
  private async getSheetIds(spreadsheetId: string): Promise<Map<string, number>> {
    try {
      const response = await this.sheetsApi.spreadsheets.get({
        spreadsheetId: spreadsheetId,
      });

      const sheetMap = new Map<string, number>();
      response.data.sheets?.forEach((sheet) => {
        if (sheet.properties?.title && sheet.properties?.sheetId != null) {
          // Lưu sheetId dưới dạng số
          sheetMap.set(sheet.properties.title, sheet.properties.sheetId);
        }
      });
      return sheetMap;
    } catch (error) {
      logger.error({ message: "Không thể lấy Sheet IDs", error });
      throw new Error("Không thể lấy thông tin Google Sheet. Hãy kiểm tra SPREADSHEET_ID.");
    }
  }
}

// Get the list of product URLS
// let productUrls: string[] = await amazonPage.$$eval("div[data-component-type='s-search-result'][data-asin]", (resultDivs) => {
//   return resultDivs
//     .map((div) => {
//       const asin = div.getAttribute("data-asin");
//       if (!asin) return null;
//       return `https://www.amazon.com/dp/${asin}`;
//     })
//     .filter((url): url is string => url !== null); // Filter the div has no asin
// });

// productUrls = productUrls.slice(0, NUMBER_OF_REQUIRED_SCRAPING_FOR_AMAZON_PRODUCT);
