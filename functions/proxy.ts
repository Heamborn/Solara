const API_BASE_URL = "https://music-dl.sayqz.com/api/";
const KUWO_HOST_PATTERN = /(^|\\.)kuwo\\.cn$/i;
const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "http:";
    return parsed;
  } catch {
    return null;
  }
}

async function proxyKuwoAudio(targetUrl: string, request: Request): Promise<Response> {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }

  const init: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Referer": "https://www.kuwo.cn/",
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyApiRequest(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(API_BASE_URL);

  // Map old parameter names to new API format
  const paramMapping: Record<string, string> = {
    "types": "type",
    "name": "keyword",
    "count": "limit",
    "pages": "page"
  };

  url.searchParams.forEach((value, key) => {
    if (key === "target" || key === "callback" || key === "s") {
      // Skip target, callback, and signature parameters
      return;
    }
    // Use mapped parameter name if exists, otherwise use original
    const mappedKey = paramMapping[key] || key;
    apiUrl.searchParams.set(mappedKey, value);
  });

  if (!apiUrl.searchParams.has("type")) {
    return new Response("Missing type parameter", { status: 400 });
  }

  // Special handling for realurl type: get the real redirected URL
  const requestType = apiUrl.searchParams.get("type");
  if (requestType === "realurl") {
    // Change type to 'url' to get the audio URL from upstream API
    apiUrl.searchParams.set("type", "url");

    try {
      // Fetch with manual redirect to capture the Location header
      const upstream = await fetch(apiUrl.toString(), {
        headers: {
          "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
        },
        redirect: "manual",
      });

      // Get the real URL from Location header
      const realUrl = upstream.headers.get("Location");

      if (!realUrl) {
        return new Response(JSON.stringify({
          code: 500,
          message: "Failed to get real audio URL",
          data: null
        }), {
          status: 500,
          headers: createCorsHeaders(new Headers({
            "Content-Type": "application/json; charset=utf-8"
          })),
        });
      }

      // Return the real URL as JSON
      const headers = createCorsHeaders(new Headers());
      headers.set("Content-Type", "application/json; charset=utf-8");

      return new Response(JSON.stringify({
        code: 200,
        message: "success",
        data: {
          url: realUrl
        }
      }), {
        status: 200,
        headers,
      });
    } catch (error) {
      return new Response(JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
        data: null
      }), {
        status: 500,
        headers: createCorsHeaders(new Headers({
          "Content-Type": "application/json; charset=utf-8"
        })),
      });
    }
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const headers = createCorsHeaders(upstream.headers);

  // 对于图片和歌词类型,保留上游的Content-Type
  // 对于其他类型(如search, info等),如果没有Content-Type则设置为JSON
  const proxyRequestType = apiUrl.searchParams.get("type");
  const isMediaType = proxyRequestType === "pic" || proxyRequestType === "lrc" || proxyRequestType === "url";

  if (!isMediaType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (target) {
    return proxyKuwoAudio(target, request);
  }

  return proxyApiRequest(url, request);
}
