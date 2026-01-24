/**
 * Phân tích một chuỗi chứa giá và ngày tháng.
 * @param rawString Chuỗi đầu vào từ scraper.
 * @returns Một object chứa giá trị và ngày tháng.
 */
export function parsePriceString(rawString: string | undefined): { value: number; latestDate: string } {
  if (!rawString || rawString.trim() === "-") {
    return { value: 0, latestDate: "" };
  }

  // Regex để tìm số và phần trong ngoặc đơn, bỏ qua mọi ký tự trắng
  const match = rawString.match(/([\d,]+\.\d+)\s*(?:\((.*?)\))?/);

  if (!match) {
    return { value: 0, latestDate: "" };
  }

  const value = parseFloat(match[1].replace(/,/g, "")) || 0;
  const latestDate = match[2] ? match[2].trim() : "";

  return { value, latestDate };
}

/**
 * Chuyển đổi chuỗi "helpful count" thành dạng số.
 * Ví dụ: "One person..." -> 1, "2 people..." -> 2, undefined -> 0
 * @param {string | undefined} text - Chuỗi văn bản từ helpfulCountText.
 * @returns {number} - Số lượt người thấy hữu ích.
 */
export const parseHelpfulCount = (text: string) => {
  if (!text) {
    return 0;
  }

  if (text.toLowerCase().startsWith("one person")) {
    return 1;
  }

  // Dùng regex để tìm tất cả các chữ số ở đầu chuỗi.
  const match = text.match(/^(\d+)/);

  if (match) {
    return parseInt(match[1], 10);
  }

  return 0;
};

/**
 * Chuyển đổi chuỗi giá tiền (VD: "$1,349.00") thành số thực (Number).
 * Xử lý được cả dấu phẩy và dấu chấm.
 */
export function parseAmazonPrice(rawString: string): number {
  if (!rawString) return 0;

  // 1. Loại bỏ tất cả ký tự KHÔNG phải là số, dấu chấm, dấu phẩy hoặc dấu trừ (cho giá âm)
  // Ví dụ: "$1,349.00" -> "1,349.00"
  // Ví dụ: "EUR 1.349,00" -> "1.349,00"
  let cleanString = rawString.replace(/[^0-9.,-]/g, "");

  // 2. Xử lý Localization (Quan trọng!)
  // Amazon US/UK dùng dấu chấm (.) cho thập phân: 1,000.00
  // Amazon EU/VN dùng dấu phẩy (,) cho thập phân: 1.000,00

  // Mẹo Senior: Kiểm tra vị trí cuối cùng của dấu . hoặc ,
  const lastDotIndex = cleanString.lastIndexOf(".");
  const lastCommaIndex = cleanString.lastIndexOf(",");

  if (lastCommaIndex > lastDotIndex) {
    // Trường hợp format EU (1.000,00) -> Đổi dấu chấm thành rỗng, dấu phẩy thành chấm
    // Kết quả mong muốn: 1000.00
    cleanString = cleanString.replace(/\./g, "").replace(",", ".");
  } else {
    // Trường hợp format US (1,000.00) -> Chỉ cần xóa dấu phẩy
    // Kết quả mong muốn: 1000.00
    cleanString = cleanString.replace(/,/g, "");
  }

  // 3. Parse sang Float và trả về
  return parseFloat(cleanString);
}
