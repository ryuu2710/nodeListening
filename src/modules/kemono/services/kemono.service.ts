import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { injectable } from "tsyringe";
import pino from "pino";
import {
  DEBUG_ENV,
  INFO_ENV,
  PPT_TIMEOUT_DEFAULT,
  PPT_WAIT_UNTIL_DEFAULT,
  PRODUCTION_ENV,
} from "#constants/index.js";
import { Browser, Page } from "puppeteer";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

puppeteerExtra.use(StealthPlugin());

@injectable()
export default class KemonoScraperService {
  constructor() {}

  /**
   * Cào (scrape) hình ảnh từ một URL Kemono, tự động cuộn vô hạn để tải tất cả ảnh.
   * @param localFolderPath Đường dẫn thư mục local để lưu ảnh (hiện chưa dùng trong logic này).
   * @param url URL của trang Kemono cần cào.
   */
public async scrapeHentaiImages(localFolderPath: string, url: string): Promise<void> {
    // Step 1. Setup the browser
    let kemonoBrowser: Browser | null = null;
    let kemonoPage: Page | null = null;
    const scrapeStartTime = Date.now();
    logger.info(`Bắt đầu tác vụ cào dữ liệu cho: ${url}`);

    try {
      kemonoBrowser = await getMyCustomRemoteBrowser();
      kemonoPage = await kemonoBrowser.newPage();
      await kemonoPage.goto(url, {
        waitUntil: PPT_WAIT_UNTIL_DEFAULT,
        timeout: PPT_TIMEOUT_DEFAULT,
      });
      logger.info(`Đã mở trang thành công.`);

      logger.info("Bắt đầu cuộn để tải toàn bộ nội dung...");
      await this.autoScroll(kemonoPage);
      logger.info("Đã cuộn đến cuối trang.");

      const imageUrls = await kemonoPage.$$eval(
        "div.post__thumbnail figure a.fileThumb.image-link",
        (links) => links.map((a) => a.href),
      );
      logger.info(`Đã tìm thấy ${imageUrls.length} hình ảnh. Bắt đầu tải về...`);

      // Step 5. Đảm bảo thư mục đích tồn tại
      await fs.promises.mkdir(localFolderPath, { recursive: true });

      // Step 6. Lặp qua và tải từng ảnh (tuần tự)
      for (const imageUrl of imageUrls) {
        // Lấy tên file từ URL
        const filename = path.basename(new URL(imageUrl).pathname);
        const destPath = path.join(localFolderPath, filename);

        // Kiểm tra xem file đã tồn tại chưa để bỏ qua
        if (fs.existsSync(destPath)) {
          logger.debug(`File ${filename} đã tồn tại, bỏ qua.`);
          continue;
        }

        try {
          const response = await fetch(imageUrl, {
            headers: {
              // Thêm Referer là 1 best practice, nhiều server ảnh sẽ chặn nếu thiếu
              Referer: url,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...', // Thêm User-Agent
            },
          });

          if (!response.ok) {
            throw new Error(`Fetch thất bại với status ${response.status} ${response.statusText}`);
          }
          if (!response.body) {
            throw new Error('Response body không tồn tại');
          }

          // Tạo một file stream để ghi
          const fileStream = fs.createWriteStream(destPath);
          // Pipe dữ liệu từ response vào file, an toàn và hiệu quả
          await pipeline(response.body as any, fileStream);

          logger.info(`Đã tải thành công: ${filename}`);
        } catch (downloadError) {
          logger.warn({ message: `Tải thất bại: ${imageUrl}`, error: downloadError });
          // Xóa file rỗng/hỏng nếu có lỗi
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
        }
      } // Kết thúc vòng lặp for

      logger.info("Hoàn tất tải về tất cả các ảnh.");
    } catch (error) {
      logger.error({ message: "Đã xảy ra lỗi nghiêm trọng trong quá trình cào dữ liệu", error });
      throw error;
    } finally {
      // Step 7. Dọn dẹp và đóng trình duyệt
      const scrapeEndTime = Date.now();
      const duration = (scrapeEndTime - scrapeStartTime) / 1000;
      logger.info(`Toàn bộ quá trình cào dữ liệu mất: ${duration.toFixed(2)} giây.`);

      if (kemonoPage) {
        await kemonoPage.close();
      }
    }
  }

  /**
   * Tự động cuộn trang đến cuối cùng bằng cách so sánh chiều cao trang.
   * Hàm sẽ tiếp tục cuộn cho đến khi chiều cao trang không còn thay đổi.
   * @param {Page} page - Đối tượng trang Puppeteer.
   */
  private async autoScroll(page: Page): Promise<void> {
    let lastHeight = await page.evaluate(() => document.body.scrollHeight);

    while (true) {
      // Cuộn xuống dưới cùng
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      logger.debug(`Đã cuộn đến ${lastHeight}. Đang chờ nội dung mới...`);

      try {
        // Chờ cho đến khi chiều cao trang thay đổi (nội dung mới được tải)
        // Hoặc chờ timeout nếu không có gì thay đổi
        await page.waitForFunction(
          (expectedHeight) => document.body.scrollHeight > expectedHeight,
          { timeout: 5000 }, // Chờ tối đa 5 giây cho nội dung mới
          lastHeight,
        );
      } catch (error) {
        // Nếu timeout (không có nội dung mới sau 5 giây), chúng ta xem như đã đến cuối.
        logger.info("Không phát hiện nội dung mới. Kết thúc cuộn.");
        break; // Thoát khỏi vòng lặp
      }

      // Cập nhật chiều cao mới để chuẩn bị cho vòng lặp tiếp theo
      lastHeight = await page.evaluate(() => document.body.scrollHeight);
    }
  }
}
