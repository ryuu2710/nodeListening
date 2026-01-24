import { BestSellerRankDTO, CamelPriceHistoryDTO, CamelPriceNodeDTO, RawCamelData } from "#types/index.js";
import { Page } from "puppeteer";
import { filterCamelPriceInfo } from "./filter";
import { parsePriceString } from "./parse";

/**
 * Tái cấu trúc một mảng phẳng thành một object được nhóm theo loại giá.
 * @param flatBody Mảng dữ liệu thô từ scraper.
 * @returns Một object với các cặp key-value, ví dụ: { 'Amazon': [...], '3rd Party New': [...] }
 */
export function reshapeCamelRawBody(flatBody: string[]): Record<string, string[]> {
  const reshaped: Record<string, string[]> = {};
  let currentKey: string | null = null;

  flatBody.forEach((item) => {
    // Nếu một item không phải là giá hoặc ký tự lạ, nó là một key mới
    if (!item.startsWith("$") && item !== "-") {
      currentKey = item;
      reshaped[currentKey] = []; // Khởi tạo một mảng mới cho key này
    } else if (currentKey) {
      // Nếu đã có key, đẩy các giá trị vào mảng của key đó
      reshaped[currentKey].push(item);
    }
  });

  return reshaped;
}

/**
 * Hàm chính để biến đổi toàn bộ body thô thành object CamelPriceComparison.
 * @param flatBody Mảng dữ liệu thô ban đầu.
 * @param targetType Loại giá muốn lấy ('Amazon', '3rd Party New', etc.).
 * @returns Một object có cấu trúc CamelPriceComparison.
 */
export function mapCamelDataToPriceHistoryJson(
  flatBody: string[],
  targetType: "Amazon" | "3rd Party New" | "3rd Party Used" = "Amazon",
): CamelPriceHistoryDTO {
  
  // 1. Tạo mẫu object rỗng (Fallback value)
  const defaultNode: CamelPriceNodeDTO = { latestDate: "", value: 0 };
  const defaultResult: CamelPriceHistoryDTO = {
    lowestPrice: defaultNode,
    highestPrice: defaultNode,
    currentPrice: defaultNode,
    averagePrice: 0,
  };

  // Bước 1: Tái cấu trúc dữ liệu
  const reshapedData = reshapeCamelRawBody(flatBody);
  const priceData = reshapedData[targetType];

  // 2. Early Return: Nếu không có data, trả về object mặc định ngay
  if (!priceData || priceData.length < 4) {
    // console.warn(`Không có đủ dữ liệu cho loại: ${targetType}`); // Uncomment nếu cần debug
    return defaultResult;
  }

  // Bước 2 & 3: Phân tích và Ánh xạ
  // Giả sử parsePriceString trả về { latestDate: string, value: number }
  const lowestPriceInfo = parsePriceString(priceData[0]);
  const highestPriceInfo = parsePriceString(priceData[1]);
  const currentPriceInfo = parsePriceString(priceData[2]);
  const averagePriceInfo = parsePriceString(priceData[3]);

  // 3. Mapping: Nếu value > 0 thì lấy, ngược lại fallback về defaultNode
  // Lưu ý: averagePrice là number nên fallback về 0
  const result: CamelPriceHistoryDTO = {
    lowestPrice: lowestPriceInfo.value > 0 ? lowestPriceInfo : defaultNode,
    highestPrice: highestPriceInfo.value > 0 ? highestPriceInfo : defaultNode,
    currentPrice: currentPriceInfo.value > 0 ? currentPriceInfo : defaultNode,
    averagePrice: averagePriceInfo.value > 0 ? averagePriceInfo.value : 0,
  };

  return result;
}

/**
 * * Get best seller ranks from dynamic HTML Element .
 * TODO: Get best seller ranks by dynamic UI.
 * @param {Page} page - The Puppeteer page object representing the current browser tab.
 * @returns {Promise<any[]>} A promise that resolves to the array of all collected comments.
 */
export async function retrieveBestSellerRankByHtmlElement(page: Page): Promise<{
  heading: string;
  attributeVal: string;
}> {
  let bestSellerRankJson = { heading: "", attributeVal: "" };
  let bestSellerRankRegex: RegExp;

  // Try to select the Best Seller Ranks from the <ul> tag first
  try {
    const bestSellerRanksUlRawText = await page.$eval("#detailBulletsWrapper_feature_div", (el) => el.textContent.trim());

    bestSellerRankRegex = /Best Sellers Rank:\s*([\s\S]+?)Customer Reviews:/;

    // Apply the regex pattern to extract the Best Sellers Rank information
    const match = bestSellerRanksUlRawText.match(bestSellerRankRegex);

    if (match) {
      const bestSellerRankText = match[1].trim();
      bestSellerRankJson = {
        heading: "Best Sellers Rank",
        attributeVal: bestSellerRankText,
      };
      return bestSellerRankJson;
    }
  } catch (error) {
    console.error("Error processing <ul> tag for Best Seller Ranks. Continuing to check table...");
  }

  // If the <ul> tag doesn't contain the Best Sellers Rank, check the <table> tag
  try {
    const queryProductDetailsContainerRawText = await page.$eval(".a-keyvalue.prodDetTable:nth-child(1)", (el) => el.textContent.trim());

    bestSellerRankRegex = /Best Sellers Rank\s+(#\d+[\s\S]+?)(?=\s+Date First Available)/;

    const bestSellerRankMatch = queryProductDetailsContainerRawText.match(bestSellerRankRegex);

    if (bestSellerRankMatch) {
      bestSellerRankJson = {
        heading: "Best Sellers Rank",
        attributeVal: bestSellerRankMatch[1].trim(),
      };
      return bestSellerRankJson;
    }
  } catch (error) {
    console.error("Error processing <table> tag for Best Seller Ranks. Continuing to check div...");
  }

  // If neither the <ul> nor <table> tags contain the Best Sellers Rank, check the <div> tag
  try {
    const queryProductDetailsContainerRawText = await page.$eval("#productDetails_db_sections", (el) => el.textContent.trim());

    bestSellerRankRegex = /Best Sellers Rank\s+(#\d+[\s\S]+?)(?=\s+Date First Available)/;
    const bestSellerRankMatch = queryProductDetailsContainerRawText.match(bestSellerRankRegex);

    if (bestSellerRankMatch) {
      bestSellerRankJson = {
        heading: "Best Sellers Rank",
        attributeVal: bestSellerRankMatch[1].trim(),
      };
      return bestSellerRankJson;
    }
  } catch (error) {
    console.error("Error processing <div> tag for Best Seller Ranks.");
  }

  // Return empty result if nothing is found
  return bestSellerRankJson;
}


export const filterBestSellerRanks = (data: string[]): BestSellerRankDTO[] => {
  let filteredBestSellerRankings: BestSellerRankDTO[] = data.map((rankString) => {
    const rankMatch = rankString.match(/#([\d,]+)/); // Updated regex to capture digits and commas
    const categoryMatch = rankString.match(/in\s+(.+?)(\s+\(See Top 100|\s*$)/);

    // if (rankMatch && rankMatch[1]) {
    //   const rankNumeric: number = parseInt(rankMatch[1].replace(/,/g, ""), 10); // Remove commas before converting
    //   console.log(`Rank value: #${rankNumeric}`);
    // }

    // if (categoryMatch && categoryMatch[1]) {
    //   console.log(`Category value: ${categoryMatch[1].trim()}`);
    // }

    return {
      rank: rankMatch ? `#${rankMatch[1].replace(/,/g, "")}` : "", // Store the rank with commas removed
      categoryMarket: categoryMatch ? categoryMatch[1].trim() : "",
    };
  });

  filteredBestSellerRankings =
    filteredBestSellerRankings.length > 0
      ? filteredBestSellerRankings.filter(
          (category) => category.rank !== "" && category.categoryMarket !== "",
        )
      : ([{ rank: "", categoryMarket: "" }] as BestSellerRankDTO[]);

  return filteredBestSellerRankings;
};
