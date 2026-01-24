import { Page } from "puppeteer";

export default class PuppeteerUtils {
  /**
 * Trích xuất text content từ một selector. Trả về chuỗi rỗng nếu không tìm thấy hoặc lỗi.
 */
  static async retrieveTextFromSelector(page: Page, selector: string): Promise<string> {
    try {
      return await page.$eval(selector, (el) => el.textContent?.trim() || "");
    } catch (error) {
      return ""; // Fail-safe: không tìm thấy thì trả về rỗng, không throw error làm sập luồng
    }
  }

  /**
   * Trích xuất và parse số nguyên từ selector (ví dụ: rating count).
   */
  static async retrieveNumberFromSelector(page: Page, selector: string): Promise<number> {
    const text: string = await this.retrieveTextFromSelector(page, selector);
    if (!text) return 0;
    // Loại bỏ ký tự không phải số (ví dụ "1,234 ratings" -> 1234)
    const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
    return isNaN(num) ? 0 : num;
  }

}
