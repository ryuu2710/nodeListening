export enum SocialPostType {
  STATUS = 'STATUS',
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  LINK = 'LINK',
  SHARE = 'SHARE',
  UNKNOWN = 'UNKNOWN'
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
