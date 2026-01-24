export interface TikTokCommentDTO {
  id: string;              // cid
  text: string;            // text
  createTime: number;      // create_time (Unix timestamp)
  likeCount?: number | 0;       // digg_count
  replyCount?: number | 0;      // reply_comment_total
  user: {
    id: string;            // uid
    uniqueId: string;      // unique_id (VD: fteti._)
    nickname: string;      // nickname (VD: fishka)
    avatarUrl: string;     // avatar_thumb.url_list[0]
    profileUrl: string;
  };
}

export interface ExcelLeadRow {
  "TÊN KHÁCH HÀNG": string;
  "ĐIỆN THOẠI": string;
  "EMAIL": string;
  "NGUỒN LEAD": string;
  "TÌNH TRẠNG LEAD": string;
  "GHI CHÚ": string; // Chứa Link Profile + Nhu cầu
}

export interface FeCreditLeadResponse {
    message: string;
    count: number;
    result: ExcelLeadRow[];
}
