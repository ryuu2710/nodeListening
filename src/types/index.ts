export interface SearchResultItem {
  url: string;
  asin: string;
  isSponsored: boolean;
}

export interface ValidationType {
  fields: string[];
  constraint: string;
}

export interface ErrorResponse {
  name: string;
  message: string;
  validationErrors?: ValidationType[];
  stack?: string;
}

export type HeadlessBrowserOptions = {
  headless: boolean;
  args?: string[];
};

// 1) A record‐style type for all required headers:
export type FacebookHeaders = {
  [K in
    | "accept"
    | "accept-language"
    | "content-type"
    | "origin"
    | "priority"
    | "referer"
    | "sec-ch-prefers-color-scheme"
    | "sec-ch-ua"
    | "sec-ch-ua-full-version-list"
    | "sec-ch-ua-mobile"
    | "sec-ch-ua-model"
    | "sec-ch-ua-platform"
    | "sec-ch-ua-platform-version"
    | "sec-fetch-dest"
    | "sec-fetch-mode"
    | "sec-fetch-site"
    | "user-agent"
    | "x-asbd-id"
    | "x-fb-friendly-name"
    | "x-fb-lsd"
    | "Cookie"]: string;
} & Record<string, string>;

export type FacebookBodyParams = {
  [K in
    | "av"
    | "__aaid"
    | "__user"
    | "__a"
    | "__req"
    | "__hs"
    | "dpr"
    | "__ccg"
    | "__rev"
    | "__s"
    | "__hsi"
    | "__dyn"
    | "__csr"
    | "__comet_req"
    | "fb_dtsg"
    | "jazoest"
    | "lsd"
    | "__spin_r"
    | "__spin_b"
    | "__spin_t"
    | "__crn"
    | "fb_api_caller_class"
    | "fb_api_req_friendly_name"
    | "variables"
    | "server_timestamps"
    | "doc_id"]: string;
} & Record<string, string>;

// ---------------------------
// 1. Interface cho phần "variables"
// ---------------------------
export interface VariablesDTO {
  data: {
    act_thread_id: string;
    direction: string;
    include_anonymized_messages: boolean;
    reference_timestamp: number | null;
    requested_messages: number;
    server_thread_key: number;
  };
}

// ---------------------------
// 2. Interface chính cho toàn bộ body
// ---------------------------
export interface FacebookGraphQLRequestDTO {
  av: string;
  __aaid: string;
  __user: string;
  __a: string;
  __req: string;
  __hs: string;
  dpr: number;
  __ccg: string;
  __rev: string;
  __s: string;
  __hsi: string;
  __dyn: string;
  __csr: string;
  __hsdp: string;
  __hblp: string;
  __comet_req: string;
  fb_dtsg: string;
  jazoest: string;
  lsd: string;
  __spin_r: string;
  __spin_b: string;
  __spin_t: string;
  __crn: string;
  fb_api_caller_class: string;
  fb_api_req_friendly_name: string;
  variables: VariablesDTO;
  server_timestamps: boolean;
  doc_id: string;
}

export interface FacebookFetchOptions extends RequestInit {
  method: "POST";
  headers: Headers;
  body: URLSearchParams;
  redirect: "follow";
}

export interface ScrapeRequest {
  groupId: string | number;
  scrollTimes?: number;
  keyword: string;
  year?: number;
}

export interface ScrapePerformanceContextParams {
  scrapeStartTime: number;
  scrapeEndTime: number;
  scrapeDurationInMs: number;
}

export interface ScrapeResultParams {
  scrapePerformance: ScrapePerformanceContextParams;
  scrapeData: any;
}

/**
 * Một "khuôn mẫu" (generic) cho kết quả cào dữ liệu.
 * Bao gồm dữ liệu hiệu suất (performance) và một payload 'data'
 * có kiểu dữ liệu được định nghĩa khi sử dụng.
 * * @template TData Kiểu dữ liệu của payload (ví dụ: BaseProductDto, FacebookPostDto)
 */
export type ScrapeResultGenParams<TData> = {
  performance: {
    // Total duration in milliseconds
    totalDurationMs: number;
    // Optional raw timestamps used to compute the above durations (if needed)
    timestamps?: {
      scrapeStartTime?: number;
      mainProductScrapeEnd?: number;
      camelScrapeEnd?: number;
      feedbackScrapeEnd?: number;
      scrapeEndTime?: number;
    };
    // Breakdown of durations in milliseconds
    breakdown: {
      mainProductPageMs: number;
      camelPageMs: number;
      feedbackPagesMs: number;
      finalProcessingMs: number;
    };
  };
count?: number | 0;
  data: TData;
};

export type AmazonScrapeResultParams = {
  performance: {
    // Total duration in milliseconds
    totalDurationMs: number;
    // Optional raw timestamps used to compute the above durations (if needed)
    timestamps?: {
      scrapeStartTime?: number;
      mainProductScrapeEnd?: number;
      camelScrapeEnd?: number;
      feedbackScrapeEnd?: number;
      scrapeEndTime?: number;
    };
    // Breakdown of durations in milliseconds
    breakdown: {
      mainProductPageMs: number;
      camelPageMs: number;
      feedbackPagesMs: number;
      finalProcessingMs: number;
    };
  };
  data: any;
};


export type CamelPriceNodeDTO = {
  latestDate: string;
  value: number;
};

export type RawCamelData = {
  type: string;
  [key: string]: string; 
};

export type CamelPriceHistoryDTO = {
  lowestPrice: CamelPriceNodeDTO;
  highestPrice: CamelPriceNodeDTO;
  currentPrice: CamelPriceNodeDTO;
  averagePrice: number;
};

export type BestSellerRankDTO = {
  rank?: string;
  categoryMarket?: string;
};

export interface ScrapedProductBasicInfoDto {
  asin: string | undefined;
  title: string;
  availability: string;
  brand: string;
  ratingStars: string;
  totalPurchasedRating: number;
  marketVolume: string;
  retailerName: string;
  isAmazonChoice: boolean;
  isBestSeller: boolean;
  bestSellerRanks: BestSellerRankDTO[];
}

export interface ScrapedCamelData {
  history: CamelPriceHistoryDTO | null;
  extra: ExtraDTO;
}

export interface ExtraDTO {
	category: string;
  manufacturer: string;
	productGroup: string;
  locale: string;
}

export type AmazonProductDTO = {
  asin: string;
  title: string;
  availability: string;
  brand: string;
  ratingStars: string;
  totalPurchasedRating: number;
  retailerName: string | null;
  isAmazonChoice: boolean;
  isBestSeller: boolean;
  marketVolume: string;
  extra: {
    category: string | null;
    manufacturer: string | null;
    productGroup: string | null;
    locale: string | null;
  };
  currentPriceOnAmazonSite: number;
  priceHistory: CamelPriceHistoryDTO | null;
  bestSellerRanks: BestSellerRankDTO[];
  feedbacks: AmazonFeedbackDTO[];
  isSponsored?: boolean;
  url: string;
};

export type AmazonFeedbackDTO = {
  username: string;
  title: string;
  description: string;
  rating: number;
  onCountry: string;
  creationTimeAsString: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
};
