import { FacebookFetchOptions, ScrapeResultParams } from "#types/index.js";
import pino from "pino";
import { cleanDirtyGqlAsFreshJson } from "./clean";
import { Page } from "puppeteer";
import { API_CONTENT_TYPE, DEBUG_ENV, HTTP_POST_METHOD, INFO_ENV, PRODUCTION_ENV } from "#constants/index.js";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

export async function fetchAndProcessBatchGqlData(
  requestOptions: FacebookFetchOptions,
  logger: pino.Logger,
): Promise<any | null> {
  try {
    const response = await fetch(`${process.env.FACEBOOK_API_DOMAIN}`, requestOptions);
    if (!response.ok) {
      logger.error(`❌ Lỗi khi fetch: ${response.status} ${response.statusText}`);
      return null;
    }
    const rawData = await response.text();
    const jsonStr = cleanDirtyGqlAsFreshJson(rawData);
    const batchData = JSON.parse(jsonStr);
    return batchData;
  } catch (err) {
    logger.error("❌ Đã xảy ra lỗi trong quá trình fetch hoặc parse JSON:");
    return null;
  }
}

export async function getCookiesFromCurrentPage(page: Page): Promise<string> {
  const cookies = await page.cookies();
  const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  return cookieString;
}

export async function sendToGoServer(projectId: string, data: ScrapeResultParams, token: string) {
  logger.info(`🚀 Bắt đầu gửi ${data.scrapeData.length} batch dữ liệu tới server Golang...`);
  try {
    const response = await fetch(
      `${process.env.DATA_PIPELINE_SERVER_PARENT_ENDPOINT}/${process.env.DATA_PIPELINE_SERVER_CHILD_ENDPOINT}/${projectId}/scraping/tiktok/profile/process-data`,
      {
        method: HTTP_POST_METHOD,
        headers: { "Content-Type": API_CONTENT_TYPE, "Authorization": `Bearer ${token}` },
        body: JSON.stringify(data, null, 2),
      },
    );

    if (!response.ok) {
      throw new Error(`Server Golang phản hồi lỗi: ${response.statusText}`);
    }
    const result = await response.json();
    logger.info("✅ Đã xử lý và ghi file từ server Golang thành công!");
    return result;
  } catch (error) {
    logger.error("❌ Lỗi khi gửi dữ liệu tới Golang:");
    throw error;
  }
}
