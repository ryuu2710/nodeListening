/**
 * Hàm tạo URL Search trong Group với bộ lọc nâng cao
 * @param groupId ID của Group
 * @param keyword Từ khóa tìm kiếm (ví dụ: "xây kênh")
 * @param year Năm cần lọc (ví dụ: 2026)
 * @returns Full URL đã có filters
 */
export function buildFbGroupSearchUrl(groupId: string, keyword: string, year?: number): string {
  const filtersObject: Record<string, string> = {
    "rp_chrono_sort:0": JSON.stringify({ name: "chronosort", args: "" }),
  };
  if (year && year > 0) {
    const dateArgs = JSON.stringify({
      start_year: year.toString(),
      end_year: year.toString(),
    });

    filtersObject["rp_creation_time"] = JSON.stringify({
      name: "creation_time",
      args: dateArgs,
    });
  }


  const filtersBase64 = Buffer.from(JSON.stringify(filtersObject)).toString("base64");
  const baseUrl = `https://www.facebook.com/groups/${groupId}/search`;

  const queryParams = new URLSearchParams({
    q: keyword,
    filters: filtersBase64,
  });

  return `${baseUrl}?${queryParams.toString()}`;
}
