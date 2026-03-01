// rabbitmq.dto.ts
export interface ScrapedPostMessage {
  topicId: string;             // UUID topic (Lấy từ DB qua API hoặc cấu hình tĩnh tạm thời)
  trackerId?: string;          // uuid of source scraping
  platform: 'FACEBOOK_GROUP' | 'FACEBOOK_PAGE';
  contentType: 'POST' | 'COMMENT';
  
  sourceUniqueId: string;     // post ID
  parentId?: string;
  
  authorName: string;
  authorId: string;
  content: string;
  publishedAt: string;         // ISO String 8601 (2026-03-01T12:00:00Z)
  platformData: {
    likes?: number;
    comments?: number;
    shares?: number;
    url?: string;
  };

  scrapedAt: string;
}
