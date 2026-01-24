import { HeadlessBrowserOptions } from "../types";

export enum UserRole {
    ADMIN = "admin",
    DEFAULT = "user",
}

export const ZERO = 0 as const;
export const ONE = 1 as const;
export const THREE = 3 as const;
export const FOUR = 4 as const;
export const SIX = 6 as const;
export const TEN = 10 as const;
export const TWENTY = 20 as const;
export const FIFTY = 50 as const;
export const SIXTY = 60 as const;
export const ONE_HUNDRED = 100 as const;
export const ONE_THOUSAND = 1000 as const;

export const REGEX_EMAIL = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;

export enum HttpCode {
    OK = 200,
    CREATED = 201,
    NO_CONTENT = 204,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    INTERNAL_SERVER_ERROR = 500,
}

export enum Platforms {
    AMAZON = "amazon",
    EBAY = "ebay",
    WALMART = "walmart",
    SHOPEE = "shopee",
    FACEBOOK = "facebook",
    INSTAGRAM = "instagram"
}

export const HEADLESS_STATE_MANAGEMENT =
    {
        DEBUG_MODE: {
            headless: false,
            args: ["--start-maximized"],
        } as HeadlessBrowserOptions,
        DEV_MODE: {
            headless: true
        } as HeadlessBrowserOptions,
        PRODUCTION_MODE: {
            headless: true
        } as HeadlessBrowserOptions
    } as const;

export const FACEBOOK_USER_FOLLOWERS_COUNT_CLASSLIST = "strong.html-strong.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1hl2dhg.x16tdsg8.x1vvkbs.x1s688f"

export const FACEBOOK_USER_ADDRESS_CLASSLIST = "span.xdmh292.x15dsfln.x140p0ai.x1gufx9m.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1lliihq.xzsf02u.xlh3980.xvmahel.x1x9mg3.xo1l8bm"

export const FACEBOOK_USER_PROFILE_NAME_CLASSLIST = ""

export const FB_USER_PROFILE_API_REQUEST_FRIENDLY_NAME = 'ProfileCometTimelineFeedRefetchQuery'
export const FB_GROUP_API_REQUEST_FRIENDLY_NAME = 'GroupsCometFeedRegularStoriesPaginationQuery'
export const FB_GROUP_API_SEARCH_REQUEST_FRIENDLY_NAME="SearchCometResultsPaginatedResultsQuery";

export const PPT_WAIT_UNTIL_DEFAULT = "networkidle2"
// export const PPT_TIMEOUT_DEFAULT = 60_000
export const PPT_TIMEOUT_DEFAULT = 500_000
export const PPT_REQUEST_KEY = "request"

export const HTTP_POST_METHOD = "POST"
export const FETCH_FB_API_REDIRECT_KEY = "follow"
export const FB_API_DEFAULT_ENDPOINT = "/api/graphql/"
export const STRING_TYPE = "string"

export const FB_API_FRIENDLY_NAME_FIRST_UPPERCASE_KEY =  "X-FB-Friendly-Name"
export const FB_API_FRIENDLY_NAME_FIRST_LOWERCASE_KEY = "x-fb-friendly-name"
export const EMPTY_STRING = "" as const;

export const CDP_REQUEST_WILL_BE_SENT_KEY = "Network.requestWillBeSent";
export const CDP_GET_REQUEST_POST_DATA_KEY = "Network.getRequestPostData";
export const CDP_NETWORK_ENABLE_TO_SEND = "Network.enable"

export const QUERY_PARAMS_RECENT_ACTIVITY = "?sorting_setting=RECENT_ACTIVITY" 
export const QUERY_PARAMS_CHRONOLOGICAL_ACTIVITY = "?sorting_setting=CHRONOLOGICAL" 
export const FB_DEFAULT_ENDPOINT = "https://www.facebook.com"
export const FB_ENDPOINT_GROUP_KEY = "groups"

export const PRODUCTION_ENV = "production"
export const DEVELOPMENT_ENV = "development"
export const INFO_ENV = "info"
export const DEBUG_ENV = "debug"

export const PUPPETEER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
export const PUPPETEER_EXTRA_HTTP_HEADER_ACCEPT_LANGUAGE_KEY = "Accept-Language";
export const PUPPETEER_EXTRA_HTTP_HEADER_ACCEPT_LANGUAGE_VALUE = "en-US,en;q=0.9";

export const API_CONTENT_TYPE = "application/json"



export const mockFbGroupIds = [
  107054892693732,
  579052783828776,
  1166454660883635,
  2188989274602898,
  "xaykenh4.0",
  "kienthuctaichinhkinhte",
  1992548960760601,
  "youneverwatchedthismovie",
];

export enum FilterProductAttributesFromUrl {
  ASIN,
  NAME,
}

export const CAMEL_CATEGORY_KEY = "Category";
export const CAMEL_MANUFACTURER_KEY = "Manufacturer";
export const CAMEL_PRODUCT_GROUP_KEY = "Product group";
export const CAMEL_LOCALE_KEY = "Locale";

export const DOM_CONTENT_LOADED_KEY = "domcontentloaded";
// GroupsCometFeedRegularStoriesPaginationQuery
// ProfileCometTopAppSectionQuery

export const NUMBER_OF_REQUIRED_SCRAPING_FOR_AMAZON_PRODUCT = 2;
// export const NUMBER_OF_REQUIRED_SCRAPING_FOR_AMAZON_PRODUCT = 20 + 1;
