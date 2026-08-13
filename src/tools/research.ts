import { config } from "dotenv";
config();

import { tool } from "@langchain/core/tools";
import { tavily } from "@tavily/core";
import { z } from "zod";
import * as cheerio from "cheerio";

// ─── Retry helpers ──────────────────────────────────────────────────────────

const DEFAULT_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES, baseDelayMs = 1000): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Retry on network/rate-limit errors; skip client errors (4xx except 429)
      const status = error?.status || error?.response?.status || error?.code;
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < retries - 1) {
        const delay = baseDelayMs * (attempt + 1) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── Tavily Client ──────────────────────────────────────────────────────────

if (!process.env.TAVILY_API_KEY) {
  console.warn("⚠️  TAVILY_API_KEY chưa được cấu hình. Tavily sẽ hoạt động ở chế độ keyless với giới hạn rất thấp.");
}

const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

// ─── Tavily Search ──────────────────────────────────────────────────────────

/**
 * Tool tìm kiếm web qua Tavily Search API.
 * Dùng includeRawContent=true để lấy nội dung đầy đủ thay vì snippet ngắn.
 */
export const tavilySearchTool = tool(
  async ({ query, maxResults = 5 }) => {
    try {
      const response = await withRetry(
        () =>
          tavilyClient.search(query, {
            maxResults,
            searchDepth: "advanced",
            includeAnswer: false, // answer không có nguồn, dùng rawContent để trích dẫn
            includeRawContent: "text",
          }),
        3,
        1500
      );

      // Format kết quả: ưu tiên rawContent, fallback content
      const formatted = [
        "**Kết quả tìm kiếm:**",
        ...response.results.map((r, i) => {
          const text = (r.rawContent || r.content || "").slice(0, 2000).trim();
          return `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${text}${text.length >= 2000 ? "..." : ""}`;
        }),
      ].join("\n");

      return formatted || "Không tìm thấy kết quả nào.";
    } catch (error: any) {
      return `Lỗi khi tìm kiếm Tavily: ${error.message}`;
    }
  },
  {
    name: "tavily_search",
    description:
      "Tìm kiếm thông tin trên web qua Tavily API. " +
      "Dùng để research thông tin mới nhất từ internet về công ty, sản phẩm, thị trường.",
    schema: z.object({
      query: z.string().describe("Từ khóa tìm kiếm (tiếng Việt hoặc tiếng Anh)"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Số lượng kết quả tối đa (mặc định 5)"),
    }),
  }
);

// ─── JS-rendered / SPA helpers ────────────────────────────────────────────

function isJsShell(text: string, html: string): boolean {
  const first = text.slice(0, 150).toLowerCase();
  const markers = [
    "enable javascript",
    "please enable js",
    "just a moment",
    "checking your browser",
    "loading",
    "cloudflare",
    "captcha",
  ];
  if (markers.some((m) => first.includes(m))) return true;

  // Common SPA indicators in raw HTML
  const spaIndicators = [
    'id="root"',
    'id="__next"',
    'id="__nuxt"',
    'id="app"',
    "__NEXT_DATA__",
    "window.__NUXT__",
    "window.__INITIAL_STATE__",
  ];
  if (spaIndicators.some((m) => html.toLowerCase().includes(m.toLowerCase())) && text.trim().length < 300) {
    return true;
  }

  return false;
}

function extractStructuredDataFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];

  // JSON-LD (rich snippets, organization info, products, etc.)
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      parts.push("JSON-LD: " + JSON.stringify(parsed, null, 2));
    } catch {
      parts.push("JSON-LD: " + raw.slice(0, 2000));
    }
  });

  // Next.js data
  const nextData = $("script#__NEXT_DATA__").text().trim();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      parts.push("NEXT_DATA: " + JSON.stringify(parsed.props?.pageProps || parsed, null, 2).slice(0, 4000));
    } catch {
      parts.push("NEXT_DATA: " + nextData.slice(0, 4000));
    }
  }

  return parts.join("\n\n---\n\n");
}

// ─── Fetch URL ──────────────────────────────────────────────────────────────

/**
 * Tool crawl nội dung từ một URL cụ thể.
 * Dùng cheerio để strip noise, retry khi lỗi mạng/rate-limit,
 * và fallback lấy structured data nếu trang JS-rendered.
 */
export const fetchUrlTool = tool(
  async ({ url }) => {
    try {
      const response = await withRetry(
        () =>
          fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          }),
        3,
        1000
      );

      if (!response.ok) {
        return `Không thể fetch URL (status ${response.status}): ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return `Không thể xử lý content type: ${contentType}`;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      $("script, style, nav, header, footer, aside, .menu, .navbar, .sidebar, .cookie-banner, .popup").remove();

      let content = $("main, article, [role='main']").first().text();
      if (!content || content.trim().length < 200) {
        content = $("body").text();
      }

      const text = content.replace(/\s+/g, " ").trim();

      if (isJsShell(text, html)) {
        const structured = extractStructuredDataFromHtml(html);
        if (structured) {
          return `### FETCH: ${url}\n[JS-RENDERED - lấy structured data fallback]\n${structured.slice(0, 8000)}`;
        }
        return `[JS-RENDERED - cần browser tool] ${url} (chỉ thấy shell ${text.length} chars)`;
      }

      return `### FETCH: ${url}\n${text.slice(0, 8000)}`;
    } catch (error: any) {
      return `Lỗi khi fetch URL: ${error.message}`;
    }
  },
  {
    name: "fetch_url",
    description:
      "Tải và đọc nội dung từ một URL cụ thể. " +
      "Dùng khi cần xem chi tiết trang web của công ty, bài báo, hoặc trang sản phẩm.",
    schema: z.object({
      url: z.string().url().describe("URL cần fetch nội dung"),
    }),
  }
);

// ─── Tool collections ────────────────────────────────────────────────────────

/**
 * Tất cả research tools (dùng cho agent chính)
 */
export const researchTools = [tavilySearchTool, fetchUrlTool];
