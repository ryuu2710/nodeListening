import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  CDP_NETWORK_ENABLE_TO_SEND,
  DEBUG_ENV,
  INFO_ENV,
  PPT_REQUEST_KEY,
  PPT_TIMEOUT_DEFAULT,
  PPT_WAIT_UNTIL_DEFAULT,
  PRODUCTION_ENV,
  TWENTY,
} from "#constants/index.js";
import pino from "pino";
import puppeteerExtra from "puppeteer-extra";
import { injectable } from "tsyringe";
import { Browser, Page } from "puppeteer";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import { FormatVnTimeMsg } from "#share/display.js";
import { ScrapePerformanceContextParams, ScrapeResultParams } from "#types/index.js";
import { sendToGoServer } from "#share/api.js";
import { ExcelLeadRow, TikTokCommentDTO } from "#types/tiktok/index.js";
import OpenAI from "openai";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

puppeteerExtra.use(StealthPlugin());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@injectable()
export default class TiktokScraperService {
  constructor() {}

  public async scrapeCommentsByVideoId(profileId: string, videoId: string): Promise<ExcelLeadRow[]> {
    let browser: Browser | null = null;
    let page: Page | null = null;
    const batchCommentItems: TikTokCommentDTO[] = [];
    const finalExcelRows: ExcelLeadRow[] = [];

    try {
      browser = await getMyCustomRemoteBrowser();
      page = await browser.newPage();

      await page.setViewport({
        width: 500,
        height: 600,
        isMobile: true,
        hasTouch: true, // Touchscreen support (important to trick TikTok into thinking it's a handheld device)
        deviceScaleFactor: 3, // Retina display (for sharpness and realism)
      });

      const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      await page.setUserAgent(userAgent);

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      const profileURL = `${process.env.TIKTOK_DOMAIN}/@${profileId}/video/${videoId}`;
      await page.goto(profileURL, { waitUntil: "networkidle2", timeout: 60000 });

      const commentIconSelector = '[data-e2e="comment-icon"]';
      const commentBtn = await page.waitForSelector(commentIconSelector, { visible: true, timeout: 15000 });

      if (commentBtn) await commentBtn.click();
      logger.info("Đã mở sidebar. Chuẩn bị setup listener...");

      let hasMoreComments = true;
      let resolveNextResponse: ((value?: unknown) => void) | null = null;

      page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/api/comment/list/")) {
          try {
            if (response.status() !== 200) return;

            const data = await response.json();
            const rawComments: any[] = data.comments || [];
            const batchSize = data.comments?.length || 0;

            logger.info(`API trả về ${batchSize} comments. Total trên server: ${data.total}`);

            if (batchSize > 0) {
              let cleanBatchDTO = rawComments.map((item: any) => this.commentDTOMapper(item));
              cleanBatchDTO = cleanBatchDTO.filter((data) => data.text !== "");
              batchCommentItems.push(...cleanBatchDTO);
            }

            hasMoreComments = data.has_more === 1;

            if (resolveNextResponse) {
              resolveNextResponse();
              resolveNextResponse = null;
            }
          } catch (e) {
            logger.warn("Lỗi parse JSON background");
          }
        }
      });

      await new Promise((r) => setTimeout(r, 2000));

      const listContainerSelector = 'div[class*="DivCommentListContainer"]';

      const containerElement = await page.waitForSelector(listContainerSelector, { timeout: 10000 });
      if (containerElement) {
        const box = await containerElement.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        }
      }

      logger.info("Bắt đầu vòng lặp Infinite Scroll...");

      while (hasMoreComments) {
        const responsePromise = new Promise<any>((resolve) => {
          resolveNextResponse = resolve;
        });

        await page.mouse.wheel({ deltaY: 2000 });

        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000, "TIMEOUT"));
        const result = await Promise.race([responsePromise, timeoutPromise]);

        if (result === "TIMEOUT") {
          logger.warn("Chưa thấy data, lăn chuột tiếp....");
        } else {
          logger.info(`BATCH DONE. Tổng hiện tại: ${batchCommentItems.length}`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      logger.info(`FINAL: Thu thập thành công ${batchCommentItems.length} comments.`);

      if (batchCommentItems.length > 0) {
        logger.info("🤖 Đang gửi dữ liệu qua AI để lọc Lead & Trích xuất SĐT...");

        // 1. Minify Data (Tiết kiệm Token)
        const minifiedData = batchCommentItems.map((item) => ({
          id: item.user.uniqueId,
          txt: item.text,
        }));

        // 2. Batch Processing (50 items/batch)
        const batchSize = 50;

        for (let i = 0; i < minifiedData.length; i += batchSize) {
          const batch = minifiedData.slice(i, i + batchSize);

          const prompt = `
            Role: Lead Hunter.
            Task: Identify intent to borrow/buy.
            RULES:
            1. Keywords: "vay", "mượn", "cần", "tư vấn", "ib", "inbox", "quan tâm", "xin tt".
            2. Short text like "ib", "tư vấn" IS A LEAD.
            3. Phone: extract 09xx, 03xx or null.
            4. Output strictly JSON: { "leads": [{ "id": "...", "phone": "...", "intent": "...", "is_lead": true }] }
            Input: ${JSON.stringify(batch)}
            `;

          try {
            const aiResults = await this.callOpenAI(prompt);

            // LOG DEBUG QUAN TRỌNG: Xem AI trả về bao nhiêu lead
            logger.info(`🔍 Batch ${i}: AI found ${aiResults.length} leads.`);

            if (aiResults && Array.isArray(aiResults)) {
              aiResults.forEach((aiItem: any) => {
                if (aiItem.is_lead) {
                  const original = batchCommentItems.find((c) => c.user.uniqueId === aiItem.id);
                  if (original) {
                    finalExcelRows.push({
                      "TÊN KHÁCH HÀNG": original.user.nickname || original.user.uniqueId,
                      "ĐIỆN THOẠI": aiItem.phone || "",
                      EMAIL: "",
                      "NGUỒN LEAD": "Social Media",
                      "TÌNH TRẠNG LEAD": "Cập nhật hồ sơ",
                      "GHI CHÚ":
                        `🔗 Profile: ${original.user.profileUrl}\n` + `📝 Nhu cầu: ${aiItem.intent || "Không rõ"}\n` + `💬 Gốc: "${original.text}"`,
                    });
                  } else {
                    logger.warn(`⚠️ AI tìm thấy lead ID ${aiItem.id} nhưng không tìm thấy trong danh sách gốc (Có thể do uniqueId bị đổi format)`);
                  }
                }
              });
            }
          } catch (err) {
            console.error(`❌ Lỗi batch ${i}:`, err);
          }
        }
      }

      logger.info(`💰 KẾT QUẢ: Tìm thấy ${finalExcelRows.length} Leads chất lượng để đổ vào Excel.`);
      console.table(finalExcelRows); // In ra bảng đẹp check chơi

      return finalExcelRows;
    } catch (error) {
      console.error({ msg: "Scrape failed", error });
      return [];
    } finally {
      if (page) await page.close();
      if (browser) browser.disconnect();
    }
  }

  private commentDTOMapper(raw: any): TikTokCommentDTO {
    return {
      id: raw.cid || "",
      text: raw.text || "",
      createTime: raw.create_time || 0,
      user: {
        id: raw.user?.uid || "",
        uniqueId: raw.user?.unique_id || "unknown",
        nickname: raw.user?.nickname || "",
        avatarUrl: raw.user?.avatar_thumb?.url_list?.[0] || "",
        profileUrl: `https://www.tiktok.com/@${raw.user?.unique_id || "unknown"}`,
      },
    };
  }

  private async callOpenAI(prompt: string): Promise<any[]> {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      logger.info("⏳ Đang gọi OpenAI...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Model này rẻ và nhanh
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const content = response.choices[0].message.content;
      console.log("📝 OpenAI Raw Content:", content);

      if (!content) {
        logger.warn("⚠️ OpenAI trả về content rỗng!");
        return [];
      }

      const parsed = JSON.parse(content);

      if (parsed.leads && Array.isArray(parsed.leads)) {
        return parsed.leads;
      }

      return (Object.values(parsed)[0] as any[]) || [];
    } catch (e: any) {
      console.error("🔥 LỖI CHẾT NGƯỜI KHI GỌI OPENAI:");
      if (e.response) {
        console.error(e.response.status);
        console.error(e.response.data);
      } else {
        console.error(e.message);
      }
      return [];
    }
  }

  /**
   * Cào toàn bộ video từ một trang profile TikTok bằng cách tự động cuộn.
   * @param profileId Tên người dùng TikTok, ví dụ: "capyboiii_7"
   * @returns Một Promise chứa mảng tất cả các đối tượng item video.
   */
  public async scrapeProfile(profileId: string, projectId: string, token: string): Promise<ScrapeResultParams | null> {
    let browser: Browser | null = null;
    const allItems: any[] = []; // Mảng để lưu tất cả video items
    const scrapeStartTime = Date.now();

    try {
      browser = await getMyCustomRemoteBrowser();
      const page: Page = await browser.newPage();
      await page.setRequestInterception(true);

      // Cho phép tất cả các request đi qua, không chặn gì cả
      page.on(PPT_REQUEST_KEY, (req) => req.continue());

      let hasMoreVideosToLoad = true;

      // Hàm để giải quyết Promise, báo hiệu đã nhận được response
      let resolveNextResponse: () => void;

      // Listen the response from the network
      page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/api/post/item_list/")) {
          try {
            const data = await response.json();
            logger.info(`API trả về ${data.itemList?.length || 0} video. HasMore: ${data.hasMore}`);

            if (data.itemList && data.itemList.length > 0) {
              allItems.push(...data.itemList);
            }
            hasMoreVideosToLoad = data.hasMore; // Cập nhật cờ hasMore

            // Nếu có một Promise đang chờ, hãy giải quyết nó
            if (resolveNextResponse) {
              resolveNextResponse();
            }
          } catch (e) {
            logger.warn({ msg: "Lỗi khi parse JSON từ response", url });
            if (resolveNextResponse) {
              resolveNextResponse();
            }
          }
        }
      });

      const profileURL: string = `${process.env.TIKTOK_DOMAIN}/@${profileId}`;
      logger.info(`Đang điều hướng tới ${profileURL}`);

      await page.goto(profileURL, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });

      logger.info("Trang đã tải xong. Bắt đầu quá trình cuộn và lấy dữ liệu...");

      while (hasMoreVideosToLoad) {
        const responsePromise = new Promise<void>((resolve) => {
          resolveNextResponse = resolve;
        });

        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight });
        });
        logger.info("Đã cuộn xuống. Chờ API response...");

        // Đợi cho đến khi listener 'response' gọi resolveNextResponse
        await responsePromise;

        // Thêm một khoảng nghỉ ngắn để tránh gửi request quá nhanh
        await new Promise((r) => setTimeout(r, 2000));
      }

      logger.info(`✅ Hoàn tất! Đã lấy được tất cả ${allItems.length} video từ profile @${profileId}.`);
      const scrapeEndTime = Date.now();
      const scrapeDurationInMs = scrapeEndTime - scrapeStartTime;

      logger.info(`✅ Đã thu thập xong ${allItems.length} batch bài viết dưới dạng Raw Json.`);
      logger.info(`✅ Thời gian bắt đầu: ${FormatVnTimeMsg(scrapeStartTime)}`);
      logger.info(`✅ Thời gian kết thúc: ${FormatVnTimeMsg(scrapeEndTime)}`);
      logger.info(`✅ Tổng thời gian thu thập dữ liệu: ${(scrapeDurationInMs / 1000).toFixed(2)} giây.`);

      var scrapePerformanceContextInfo: ScrapePerformanceContextParams = {
        scrapeStartTime,
        scrapeEndTime,
        scrapeDurationInMs,
      };

      var scrapeResult: ScrapeResultParams = {
        scrapePerformance: scrapePerformanceContextInfo,
        scrapeData: allItems,
      };

      var data: any = [];
      if (allItems.length > 0) {
        data = await sendToGoServer(projectId, scrapeResult, token);
      }

      return scrapeResult;
    } catch (error) {
      logger.error({ msg: "Đã xảy ra lỗi nghiêm trọng trong quá trình scrape", error });
      return null;
    } finally {
      if (browser) {
        await browser.disconnect();
        // await browser.close();
        logger.info("Đã đóng trình duyệt.");
      }
    }
  }
}
