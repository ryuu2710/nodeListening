import { CDPSession } from "puppeteer";
import {
  FacebookBodyParams,
  FacebookFetchOptions,
  FacebookGraphQLRequestDTO,
  FacebookHeaders,
  FbCommentVariables,
  VariablesDTO,
} from "../types";
import {
  EMPTY_STRING,
  FB_API_DEFAULT_ENDPOINT,
  FB_API_FRIENDLY_NAME_FIRST_LOWERCASE_KEY,
  FB_API_FRIENDLY_NAME_FIRST_UPPERCASE_KEY,
  FETCH_FB_API_REDIRECT_KEY,
  HTTP_POST_METHOD,
  CDP_GET_REQUEST_POST_DATA_KEY,
  CDP_REQUEST_WILL_BE_SENT_KEY,
  STRING_TYPE,
} from "#constants/index.js";

/**
 * Build a URLSearchParams from overrides + defaults
 */
export function BuildFacebookBodyParams(
  bodyParamObject: FacebookBodyParams,
  overrides: Partial<FacebookBodyParams> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(bodyParamObject) as Array<
    keyof FacebookBodyParams
  >) {
    params.append(key, overrides[key] ?? bodyParamObject[key]);
  }
  return params;
}

// Nếu dùng trong môi trường Node hoặc trình duyệt hỗ trợ URLSearchParams:
export function parseFacebookBody(rawBody: string): FacebookGraphQLRequestDTO {
  // Bước 1: Tạo URLSearchParams
  const params = new URLSearchParams(rawBody);

  // Bước 2: Lấy từng giá trị (string) từ params.get(...)
  // Chú ý: chúng ta dùng "!" (non-null assertion) vì giả định chuỗi luôn có đầy đủ các key này.
  const av = params.get("av")!;
  const __aaid = params.get("__aaid")!;
  const __user = params.get("__user")!;
  const __a = params.get("__a")!;
  const __req = params.get("__req")!;
  const __hs = params.get("__hs")!;
  // dpr chuyển sang number
  const dpr = Number(params.get("dpr"));
  const __ccg = params.get("__ccg")!;
  const __rev = params.get("__rev")!;
  const __s = params.get("__s")!;
  const __hsi = params.get("__hsi")!;
  const __dyn = params.get("__dyn")!;
  const __csr = params.get("__csr")!;
  const __hsdp = params.get("__hsdp")!;
  const __hblp = params.get("__hblp")!;
  const __comet_req = params.get("__comet_req")!;
  const fb_dtsg = params.get("fb_dtsg")!;
  const jazoest = params.get("jazoest")!;
  const lsd = params.get("lsd")!;
  const __spin_r = params.get("__spin_r")!;
  const __spin_b = params.get("__spin_b")!;
  const __spin_t = params.get("__spin_t")!;
  const __crn = params.get("__crn")!;
  const fb_api_caller_class = params.get("fb_api_caller_class")!;
  const fb_api_req_friendly_name = params.get("fb_api_req_friendly_name")!;

  // Phần variables ban đầu là một JSON string (percent-encoded).
  // Ví dụ: '{"data":{"act_thread_id":"100006463826516","direction":"AFTER",…}}'
  const variablesRaw = params.get("variables")!;
  let variablesParsed: VariablesDTO;
  try {
    variablesParsed = JSON.parse(variablesRaw) as VariablesDTO;
  } catch (err) {
    throw new Error(
      `Không parse được phần variables payload sang JSON: ${(err as Error).message}`,
    );
  }

  // Chuyển server_timestamps từ "true"/"false" → boolean
  const server_timestamps = params.get("server_timestamps") === "true";

  // doc_id dưới dạng string
  const doc_id = params.get("doc_id")!;

  // Bước 3: Đóng gói thành object đúng cấu trúc DTO
  const dto: FacebookGraphQLRequestDTO = {
    av,
    __aaid,
    __user,
    __a,
    __req,
    __hs,
    dpr,
    __ccg,
    __rev,
    __s,
    __hsi,
    __dyn,
    __csr,
    __hsdp,
    __hblp,
    __comet_req,
    fb_dtsg,
    jazoest,
    lsd,
    __spin_r,
    __spin_b,
    __spin_t,
    __crn,
    fb_api_caller_class,
    fb_api_req_friendly_name,
    variables: variablesParsed,
    server_timestamps,
    doc_id,
  };

  return dto;
}

async function BuildHeaderDTO(
  recordHeaders: Record<string, string>,
  cookieValue: string,
): Promise<FacebookHeaders> {
  recordHeaders["accept"] = "*/*";
  recordHeaders["content-type"] = "application/x-www-form-urlencoded";
  recordHeaders["origin"] = "https://www.facebook.com";
  recordHeaders["priority"] = "u=1, i";
  recordHeaders["referer"] = recordHeaders["Referer"];
  recordHeaders["user-agent"] = recordHeaders["User-Agent"];
  recordHeaders["x-asbd-id"] = recordHeaders["X-ASBD-ID"];
  recordHeaders["x-fb-friendly-name"] = recordHeaders["X-FB-Friendly-Name"];
  recordHeaders["x-fb-lsd"] = recordHeaders["X-FB-LSD"];

  const fbHeadersDto: FacebookHeaders = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/x-www-form-urlencoded",
    origin: recordHeaders["origin"],
    priority: recordHeaders["priority"],
    referer: recordHeaders["referer"],
    "sec-ch-prefers-color-scheme": recordHeaders["sec-ch-prefers-color-scheme"],
    "sec-ch-ua": recordHeaders["sec-ch-ua"],
    "sec-ch-ua-full-version-list": recordHeaders["sec-ch-ua-full-version-list"],
    "sec-ch-ua-mobile": recordHeaders["sec-ch-ua-mobile"],
    "sec-ch-ua-model": recordHeaders["sec-ch-ua-model"],
    "sec-ch-ua-platform": recordHeaders["sec-ch-ua-platform"],
    "sec-ch-ua-platform-version": recordHeaders["sec-ch-ua-platform-version"],
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": recordHeaders["user-agent"],
    "x-asbd-id": recordHeaders["x-asbd-id"],
    "x-fb-friendly-name": recordHeaders["x-fb-friendly-name"],
    "x-fb-lsd": recordHeaders["x-fb-lsd"],
    Cookie: cookieValue,
  };

  return fbHeadersDto;
}

// Build request body object
export async function BuildBodyParamsConfig(
  content: string,
): Promise<FacebookBodyParams> {
  const params: URLSearchParams = new URLSearchParams(content);
  const bodyRecord: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    bodyRecord[key] = value;
  }

  const fbBodyParamsConfig: FacebookBodyParams = {
    av: bodyRecord["av"],
    __aaid: bodyRecord["__aaid"],
    __user: bodyRecord["__user"],
    __a: bodyRecord["__a"],
    __req: bodyRecord["__req"],
    __hs: bodyRecord["__hs"],
    dpr: bodyRecord["dpr"].toString(),
    __ccg: bodyRecord["__ccg"],
    __rev: bodyRecord["__rev"],
    __s: bodyRecord["__s"],
    __hsi: bodyRecord["__hsi"],
    __dyn: bodyRecord["__dyn"],
    __csr: bodyRecord["__csr"],
    __comet_req: bodyRecord["__comet_req"],
    fb_dtsg: bodyRecord["fb_dtsg"],
    jazoest: bodyRecord["jazoest"],
    lsd: bodyRecord["lsd"],
    __spin_r: bodyRecord["__spin_r"],
    __spin_b: bodyRecord["__spin_b"],
    __spin_t: bodyRecord["__spin_t"],
    __crn: bodyRecord["__crn"],
    fb_api_caller_class: bodyRecord["fb_api_caller_class"],
    fb_api_req_friendly_name: bodyRecord["fb_api_req_friendly_name"],
    variables: bodyRecord["variables"],
    server_timestamps: bodyRecord["server_timestamps"],
    doc_id: bodyRecord["doc_id"],
  };

  return fbBodyParamsConfig;
}

// Build request completion for calling Facebook API
export async function BuildFbRequestOptionsForCallApi_V2(
  headersRaw: Record<string, string>,
  bodyRaw: string,
  cookieValue: string,
  nextCursor?: string
): Promise<FacebookFetchOptions> {
  const fbHeadersDto = await BuildHeaderDTO(headersRaw, cookieValue);
  const fbBodyDto: FacebookBodyParams = await BuildBodyParamsConfig(bodyRaw);

  if(nextCursor && fbBodyDto.variables) {
    try {
      const varJson: FbCommentVariables = JSON.parse(fbBodyDto.variables);
      varJson.commentsAfterCursor = nextCursor;

      fbBodyDto.variables = JSON.stringify(varJson);
    } catch (error) {
      console.warn("Error parsing and mutating variables:", error);
    }
  }

  const fbHeadersBuilder = new Headers(fbHeadersDto);
  const fbBodyBuilder = BuildFacebookBodyParams(fbBodyDto);

  return {
    method: HTTP_POST_METHOD,
    headers: fbHeadersBuilder,
    body: fbBodyBuilder,
    redirect: FETCH_FB_API_REDIRECT_KEY,
  } as FacebookFetchOptions;
}

export async function BuildFbRequestOptionsForCallApi(
  headersRaw: Record<string, string>,
  bodyRaw: string,
  cookieValue: string,
): Promise<FacebookFetchOptions> {
  const fbHeadersDto = await BuildHeaderDTO(headersRaw, cookieValue);
  const fbBodyDto: FacebookBodyParams = await BuildBodyParamsConfig(bodyRaw);

  const fbHeadersBuilder = new Headers(fbHeadersDto);
  const fbBodyBuilder = BuildFacebookBodyParams(fbBodyDto);

  return {
    method: HTTP_POST_METHOD,
    headers: fbHeadersBuilder,
    body: fbBodyBuilder,
    redirect: FETCH_FB_API_REDIRECT_KEY,
  } as FacebookFetchOptions;
}

export function WaitNextGraphQL(
  client: CDPSession,
  targetFriendlyName: string,
): Promise<{ headers: Record<string, string>; bodyRaw: string }> {
  return new Promise((resolve) => {
    const listener = async (event: any) => {
      const { requestId, request } = event;

      if (
        typeof request.url === STRING_TYPE &&
        request.url.includes(FB_API_DEFAULT_ENDPOINT) &&
        request.method === HTTP_POST_METHOD
      ) {
        const allHeaders = request.headers as Record<string, string>;
        const friendlyName =
          allHeaders[FB_API_FRIENDLY_NAME_FIRST_UPPERCASE_KEY] ||
          allHeaders[FB_API_FRIENDLY_NAME_FIRST_LOWERCASE_KEY] ||
          EMPTY_STRING;

        if (friendlyName === targetFriendlyName) {
          // remove listener if found
          client.off(CDP_REQUEST_WILL_BE_SENT_KEY, listener);
          let rawBody: string = request.postData ?? "";
          if (!rawBody) {
            try {
              const resp = await client.send(CDP_GET_REQUEST_POST_DATA_KEY, {
                requestId,
              });
              rawBody = resp.postData || "";
            } catch {
              rawBody = "";
            }
          }

          return resolve({
            headers: allHeaders,
            bodyRaw: rawBody,
          });
        }
      }
    };
    client.on(CDP_REQUEST_WILL_BE_SENT_KEY, listener);
  });
}
