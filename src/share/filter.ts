import { FilterProductAttributesFromUrl } from "#constants/index.js";

// filterAsinFromUrl get asin code by given URL
export const filterAsinFromUrl = (
  url: string,
  field: FilterProductAttributesFromUrl,
): string | undefined => {
  const regexOfAsin = /\/dp\/([A-Z0-9]+)/;
  const regexOfName = /amazon\.com\/([^\/]+)\/dp\//;
  // Execute the regex on the URL
  let match;
  if (field === FilterProductAttributesFromUrl.ASIN) {
    match = url.match(regexOfAsin);
  } else {
    match = url.match(regexOfName);
  }

  if (match) {
    return match[1];
  } else {
    console.log("No match found of asin from URL");
  }
};

/**
 * Phân tích một chuỗi chứa giá và ngày tháng.
 * Ví dụ: "$116.71 (Nov 04, 2024)" -> { value: 116.71, latestDate: "Nov 04, 2024" }
 * Hoặc: "$125.50" -> { value: 125.50, latestDate: "" }
 * @param rawString Chuỗi đầu vào từ scraper.
 * @returns Một object chứa giá trị và ngày tháng.
 */
export function filterCamelPriceInfo(rawString: string | undefined): { value: number; latestDate: string } {
  if (!rawString) {
    return { value: 0, latestDate: '' };
  }

  // Regex để tìm số (có thể có dấu phẩy) và phần trong ngoặc đơn
  const match = rawString.match(/([\d,]+\.\d+)\s*(?:\((.*?)\))?/);

  if (!match) {
    return { value: 0, latestDate: '' };
  }

  // match[1] là giá, ví dụ: "116.71"
  // match[2] là ngày tháng, ví dụ: "Nov 04, 2024" hoặc undefined
  const value = parseFloat(match[1].replace(/,/g, '')) || 0;
  const latestDate = match[2] ? match[2].trim() : '';

  return { value, latestDate };
}

/** 
 * Phân tích 1 chuỗi chứa location và ngày tháng năm
 */
export const filterLocationAndDateOfFeedbackItem = (
  rawData: string | undefined,
): string[] => {
  const regex = /in (?:the\s)?(.*?) on (.*)/;

  if (!rawData) {
    console.log("No rawData provided");
    return [];
  }

  const match = rawData.match(regex);

  if (match) {
    const country: string = match[1]; // "United States"
    const date: string = match[2]; // "March 1, 2023"s
    const resultArray: string[] = [country, date];

    return resultArray as string[]; // Output: ["United States", "March 1, 2023"]
  } else {
    console.log("No match found");
    return [];
  }
};
