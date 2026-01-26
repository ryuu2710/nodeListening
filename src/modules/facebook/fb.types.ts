export interface SocialFbMention {
  id: string;
  url: string;
  content: string;
  author: {
    id: string;
    name: string;
    isAnonymous: boolean;
  };
  stats: {
    likes: number;
    comments: number;
    shares: number;
    reactionBreakdown: Record<string, number>; // { like: 10, love: 5 }
  };
  createdAtTs: number;
  scrapeSessionId?: string; 
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
