/**
 * Định nghĩa cấu trúc cho một Fanpage (Brand hoặc KOL)
 */
export interface SocialPageEntity {
  name: string;
  url: string;
  id?: string;
  note?: string;
  type?: string;
}

export interface CampaignDuration {
  startDate: string; // ISO 8601 format: "2024-11-01T00:00:00Z"
  endDate: string;
}

export interface CampaignSources {
  // A. OWNED MEDIA: Fanpage
  ownedPages: SocialPageEntity[];

  // B. PAID MEDIA: Fanpage KOLs/Influencers
  kolPages: SocialPageEntity[];

  // C. EARNED MEDIA: Keyword to find in Group/Search
  keywords: string[];
}

export interface TopicDefinition {
  code: string;
  keywords: string[];
}

export interface CampaignConfig {
  campaign_name: string;
  projectCode: string;     // Unique ID (VD: "zalopay_tet_2025")
  duration: CampaignDuration;
  sources: CampaignSources;
  topics: TopicDefinition[];
}

export enum SocialPostType {
  STATUS = 'STATUS',
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  LINK = 'LINK',
  SHARE = 'SHARE',
  UNKNOWN = 'UNKNOWN'
}

export enum MentionType {
  POST = 'POST',
  COMMENT = 'COMMENT'
}

export enum ChannelType {
  OWNED = 'OWNED',   // Fanpage ZaloPay
  PAID = 'PAID',     // KOLs
  EARNED = 'EARNED'  // Group/User
}

export enum SentimentType {
  POSITIVE = 'POSITIVE',
  NEUTRAL = 'NEUTRAL',
  NEGATIVE = 'NEGATIVE'
}

export interface SocialAuthor {
  id: string;
  name: string;
  url: string;
  avatar?: string;
  isVerified?: boolean;
}

export interface SocialAttachment {
  type: 'IMAGE' | 'VIDEO' | 'LINK';
  url: string;
  thumbnail?: string;
}

export interface SocialFbMention {
  id: string;
  url: string;
  content: string;
  authorMock?: {
    id: string;
    name: string;
    isAnonymous: boolean;
  };
  author?: SocialAuthor;
  attachments?: SocialAttachment[];
  stats: {
    likes: number;
    comments: number;
    shares: number;
    reactionBreakdown: Record<string, number>; // { like: 10, love: 5 }
  };
  createdAtTs: number;
  publishedAt: Date;
  scrapeSessionId?: string;
  metadata?: {
    isAds?: boolean;
    isPinned?: boolean;
  }
}

export interface SocialFbComment {
  id: string;
  content: string;
  postId: string;
  postURL?: string;
  commentURL?: string;
  author: {
    id: string;
    name: string;
    avatar: string;
    url: string;
  };
  stats: {
    likes: number;
    replies: number;
  };
  publishedAt: Date;
}
