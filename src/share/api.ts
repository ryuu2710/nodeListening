import { FacebookFetchOptions, ScrapeResultParams } from "#types/index.js";
import pino from "pino";
import { cleanDirtyGqlAsArrayJson, cleanDirtyGqlAsFreshJson } from "./clean";
import { Page } from "puppeteer";
import { API_CONTENT_TYPE, DEBUG_ENV, HTTP_POST_METHOD, INFO_ENV, PRODUCTION_ENV } from "#constants/index.js";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

export async function fetchAndProcessMainGqlData(
  requestOptions: FacebookFetchOptions,
  logger: pino.Logger,
): Promise<any | null> {
  try {
    console.log("0");
    const response = await fetch(`${process.env.FACEBOOK_API_DOMAIN}`, requestOptions);
    if (!response.ok) {
      logger.error(`❌ Error fetching: ${response.status} ${response.statusText}`);
      return null;
    }
    const rawData = await response.text();
    console.log("\n\n\nLength of batch raw");
    console.log(Array.from(rawData).length);
    const jsonStr = cleanDirtyGqlAsFreshJson(rawData);
    const batchData = JSON.parse(jsonStr);
    return batchData;
  } catch (err) {
    console.log("An error occurred while fetching or parsing JSON.: ", err as any);
    return null;
  }
}

export async function fetchAndProcessBatchGqlData(
  requestOptions: FacebookFetchOptions,
  logger: pino.Logger,
): Promise<any[]> {
  try {
    const response = await fetch(`${process.env.FACEBOOK_API_DOMAIN}`, requestOptions);
    if (!response.ok) {
      logger.error(`Error fetching: ${response.status} ${response.statusText}`);
      return [];
    }
    const rawData = await response.text();
    const jsonArr = cleanDirtyGqlAsArrayJson(rawData);

    if(jsonArr.length === 0) {
      logger.warn("Not found any json in the current response");
      return [];
    }
    return jsonArr;
  } catch (err) {
    console.log("An error occurred while fetching or parsing JSON.: ", err as any);
    return [];
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
    logger.error("Lỗi khi gửi dữ liệu tới Golang:");
    throw error;
  }
}
