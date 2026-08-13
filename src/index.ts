/**
 * VNF Company Research Agent — Entry Point
 *
 * Pipeline:
 * 1. Người dùng nhập 1 câu tự nhiên (tên/URL + tùy chọn ngôn ngữ + lý do)
 * 2. LLM parse input → trích xuất companyName, URL, language, reason
 * 3. Chạy research pipeline: plan → crawl (parallel) → validate → propose → report
 * 4. Hiển thị kết quả + lưu file Markdown
 * 5. Hỗ trợ multi-turn: research xong → hỏi công ty tiếp theo
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import OpenAI from "openai";
import { runResearch } from "./graph.js";
import type { OutputLanguage } from "./state.js";

// ─── LLM Client (dùng riêng cho parse input) ───────────────────────────────

let llmClient: OpenAI | undefined;
function getLLM(): OpenAI {
  if (!llmClient) {
    llmClient = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_API_URL,
    });
  }
  return llmClient;
}

const MODEL = process.env.MODEL || "gpt-4o-mini";

// ─── Discover company URL ───────────────────────────────────────────────────

/**
 * Dùng Tavily tìm website chính thức của công ty khi user chỉ nhập tên.
 * Trả về URL hoặc null nếu không tìm được / hết quota.
 */
async function discoverCompanyUrl(companyName: string): Promise<string | null> {
  try {
    const { tavilySearchTool } = await import("./tools/research.js");

    // Tìm cả bằng tên gốc và tên tiếng Anh / tên viết tắt phổ biến
    const queries = [
      `${companyName} official website`,
      `${companyName} homepage`,
    ];

    let bestUrl: string | null = null;
    let bestScore = -1;

    for (const query of queries) {
      const result = await tavilySearchTool.invoke({
        query,
        maxResults: 5,
      });

      const content = String(result || "");
      if (content.includes("daily keyless Tavily limit") || content.includes("Lỗi khi tìm kiếm Tavily")) {
        console.warn("  ⚠️  Tavily đã hết quota, không thể tự động tìm URL.");
        return null;
      }

      // Extract URLs with priority scoring
      const urlRegex = /(https?:\/\/[^\s\),.;\"'>]+)/g;
      const matches = content.match(urlRegex) || [];

      for (const rawUrl of matches) {
        let url = rawUrl.replace(/[,.;\"'\)>]+$/, "");
        if (url.length < 10) continue;

        try {
          const parsed = new URL(url);
          const path = parsed.pathname.toLowerCase();
          const host = parsed.hostname.toLowerCase();

          // Skip aggregator / social / news / subpages that are not homepage
          const isAggregator =
            host.includes("sciencespace.vn") ||
            host.includes("masothue.com") ||
            host.includes("linkedin.com") ||
            host.includes("facebook.com") ||
            host.includes("youtube.com") ||
            host.includes("wikipedia.org") ||
            host.includes("crunchbase.com") ||
            host.includes("bloomberg.com");

          if (isAggregator) continue;

          // Score homepage / short path higher; prefer official domains
          let score = 0;
          if (path === "/" || path === "" || path === "/en/" || path === "/vi/") score += 100;
          else if (path.split("/").filter(Boolean).length <= 1) score += 30;

          // Prefer .org for NGOs, .com.vn / .vn / .com for companies
          if (host.endsWith(".org")) score += 20;
          else if (host.endsWith(".com.vn") || host.endsWith(".vn")) score += 15;
          else if (host.endsWith(".com")) score += 10;

          // Prefer hostname containing simplified company name tokens
          const normalizedCompany = companyName
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "");
          const normalizedHost = host.replace(/[^a-z0-9]/g, "");
          if (normalizedHost.includes(normalizedCompany.slice(0, 12))) score += 25;

          if (score > bestScore) {
            bestScore = score;
            bestUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "/");
          }
        } catch {
          // ignore invalid URL
        }
      }
    }

    return bestUrl;
  } catch (e: any) {
    console.warn(`  ⚠️  Không tìm được URL: ${e.message?.slice(0, 80)}`);
  }
  return null;
}

// ─── Parse user input bằng LLM ──────────────────────────────────────────────

interface ParsedInput {
  companyName: string;
  companyUrl: string | null;
  outputLanguage: OutputLanguage;
  vnfInterestReason: string;
  /** Các field còn thiếu cần hỏi lại */
  missingFields: string[];
}

const PARSE_INPUT_PROMPT = `Bạn là trợ lý phân tích yêu cầu research công ty của người dùng.

Từ câu nhập của người dùng (có thể là tiếng Việt hoặc tiếng Anh), hãy trích xuất các thông tin sau:

1. **companyName**: Tên công ty cần research (BẮT BUỘC)
2. **companyUrl**: Website URL nếu người dùng cung cấp (có thể null)
3. **outputLanguage**: Ngôn ngữ output mong muốn:
   - "vi" = tiếng Việt
   - "en" = English
   - "bilingual" = song ngữ Việt-Anh
   (mặc định "vi" nếu không đề cập)
4. **vnfInterestReason**: Lý do VNF quan tâm đến công ty này:
   - "Đối thủ cạnh tranh" nếu user nói "đối thủ", "cạnh tranh", "competitor"
   - "Đối tác phân phối" nếu "đối tác", "phân phối", "partner", "distributor"
   - "Khách hàng tiềm năng" nếu "khách hàng", "customer", "client"
   - "Nhà cung cấp" nếu "nhà cung cấp", "supplier", "vendor"
   - "Tổ chức phi lợi nhuận / NGO" nếu input có NGO, "phi lợi nhuận", "viện nghiên cứu", "quỹ", "foundation", "institute", "non-profit"
   - Suy luận từ ngữ cảnh nếu user không nói rõ
   (mặc định: "Tìm hiểu thông tin" nếu không đoán được)
5. **missingFields**: Danh sách field quan trọng còn thiếu (chỉ liệt kê companyName nếu không tìm thấy)

QUAN TRỌNG:
- Người dùng có thể nhập rất ngắn gọn (vd: "VNG") hoặc đầy đủ (vd: "Tìm hiểu công ty VNG bằng tiếng Anh, đối thủ cạnh tranh")
- Cố gắng suy luận ngôn ngữ và lý do từ ngữ cảnh, không cần user nói rõ
- Chỉ trả về JSON, không thêm text gì khác

OUTPUT FORMAT (JSON):
{
  "companyName": "...",
  "companyUrl": "..." | null,
  "outputLanguage": "vi" | "en" | "bilingual",
  "vnfInterestReason": "...",
  "missingFields": ["..."]
}`;

/**
 * Dùng LLM để parse câu nhập tự nhiên của người dùng.
 */
async function parseUserInput(raw: string): Promise<ParsedInput> {
  const response = await getLLM().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: PARSE_INPUT_PROMPT },
      { role: "user", content: raw },
    ],
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const jsonMatch =
      content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);

    return {
      companyName: parsed.companyName || "",
      companyUrl: parsed.companyUrl || null,
      outputLanguage: parsed.outputLanguage || "vi",
      vnfInterestReason: parsed.vnfInterestReason || "Tìm hiểu thông tin",
      missingFields: parsed.missingFields || [],
    };
  } catch {
    // Fallback: parse thủ công nếu LLM không trả về JSON
    return fallbackParse(raw);
  }
}

/** Fallback parser khi LLM không trả JSON */
function fallbackParse(raw: string): ParsedInput {
  const trimmed = raw.trim();

  // Phát hiện URL
  let companyUrl: string | null = null;
  let companyName = trimmed;

  const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    companyUrl = urlMatch[1];
    try {
      const hostname = new URL(companyUrl).hostname;
      companyName = hostname.replace(/^www\./i, "").split(".")[0];
    } catch {}
  } else if (/^[\w-]+\.[\w-]+$/.test(trimmed.split(/\s+/)[0])) {
    const domain = trimmed.split(/\s+/)[0];
    companyUrl = `https://${domain}`;
    companyName = domain.replace(/^www\./i, "").split(".")[0];
  }

  // Phát hiện ngôn ngữ
  let outputLanguage: OutputLanguage = "vi";
  const lower = trimmed.toLowerCase();
  if (/\benglish\b|\btiếng anh\b|\ben\b/i.test(lower)) outputLanguage = "en";
  else if (/\bbilingual\b|\bsong ngữ\b|\bsong ngu\b/i.test(lower))
    outputLanguage = "bilingual";

  // Phát hiện lý do — ưu tiên NGO / institute trước khi xét đối tác/khách hàng
  let vnfInterestReason = "Tìm hiểu thông tin";
  if (/\bngo\b|\bphi lợi nhuận\b|\bnon-profit\b|\bfoundation\b|\bquỹ\b|\bviện nghiên cứu\b|\binstitute\b|\buniversity\b|\btrường\b/i.test(lower))
    vnfInterestReason = "Tổ chức phi lợi nhuận / NGO";
  else if (/\bđối thủ\b|\bcạnh tranh\b|\bcompetitor\b/i.test(lower))
    vnfInterestReason = "Đối thủ cạnh tranh";
  else if (/\bđối tác\b|\bphân phối\b|\bpartner\b|\bdistributor\b/i.test(lower))
    vnfInterestReason = "Đối tác phân phối";
  else if (/\bkhách hàng\b|\bcustomer\b|\bclient\b/i.test(lower))
    vnfInterestReason = "Khách hàng tiềm năng";
  else if (/\bnhà cung cấp\b|\bsupplier\b|\bvendor\b/i.test(lower))
    vnfInterestReason = "Nhà cung cấp";

  return {
    companyName: companyName.replace(/[^\w\s\u00C0-\u1EF9&-]/g, "").trim(),
    companyUrl,
    outputLanguage,
    vnfInterestReason,
    missingFields: companyName ? [] : ["companyName"],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let input = args.join(" ").trim();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     🏢 VNF Company Research Agent — LangGraph            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n📋 Model: ${MODEL}`);
  console.log(`🔗 API: ${process.env.AI_API_URL || "https://api.mistral.ai/v1/"}`);
  console.log("💡 Nhập 1 câu tự nhiên — LLM sẽ tự hiểu tên công ty, ngôn ngữ, lý do:");
  console.log("   ┌─────────────────────────────────────────────────────────────┐");
  console.log("   │  VNG, tiếng Anh, đối thủ                                   │");
  console.log("   │  Tìm hiểu công ty VNG Corporation, song ngữ, khách hàng    │");
  console.log("   │  vng.com.vn                                                │");
  console.log("   │  https://vng.com.vn  (đối tác phân phối)                   │");
  console.log("   │  Nestlé Vietnam, English, supplier                         │");
  console.log("   └─────────────────────────────────────────────────────────────┘");
  console.log("   Gõ 'exit' để thoát.\n");

  const rl = createInterface({ input: stdin, output: stdout });

  // ─── Multi-turn loop ──────────────────────────────────────────────────────
  while (true) {
    // ── Step 1: 1 câu duy nhất ────────────────────────────────────────────
    if (!input) {
      const answer = (await rl.question("💬 Research: ")).trim();
      if (!answer) continue;

      if (answer.toLowerCase() === "exit" || answer.toLowerCase() === "quit") {
        console.log("👋 Tạm biệt!");
        break;
      }

      input = answer;
    }

    // ── Step 2: LLM parse input ───────────────────────────────────────────
    console.log("⏳ Đang phân tích yêu cầu...");
    const parsed = await parseUserInput(input);

    if (!parsed.companyName) {
      console.log("❌ Không nhận diện được tên công ty. Vui lòng nhập lại.\n");
      input = "";
      continue;
    }

    console.log(`   📌 Công ty: ${parsed.companyName}`);
    if (parsed.companyUrl) console.log(`   🔗 URL: ${parsed.companyUrl}`);
    console.log(`   🌐 Ngôn ngữ: ${parsed.outputLanguage}`);
    console.log(`   🎯 Lý do: ${parsed.vnfInterestReason}`);

    // ── Step 2b: Tìm URL nếu user chỉ nhập tên ───────────────────────────
    let companyUrl = parsed.companyUrl;
    if (!companyUrl) {
      console.log("   🔍 Chưa có URL → đang tìm website chính thức...");
      const discovered = await discoverCompanyUrl(parsed.companyName);
      if (discovered) {
        companyUrl = discovered;
        console.log(`   ✅ Tìm thấy URL: ${companyUrl}`);
      } else {
        console.warn("   ⚠️  Không tìm được URL. Báo cáo sẽ dựa trên web search (có thể thiếu sót).");
        console.warn("   💡 Gợi ý: Lần sau nhập kèm URL để kết quả chính xác hơn.");
      }
    }

    // Nếu thiếu field quan trọng → hỏi bổ sung NHANH (1 câu)
    if (parsed.missingFields.includes("companyName")) {
      const fixAnswer = await rl.question(
        "   ❓ Chưa rõ tên công ty, vui lòng nhập lại: "
      );
      if (fixAnswer.trim()) {
        input = fixAnswer.trim();
        continue;
      }
    }

    console.log("");

    // ── Step 3: Run research ──────────────────────────────────────────────
    try {
      const finalState = await runResearch({
        companyName: parsed.companyName,
        companyUrl,
        outputLanguage: parsed.outputLanguage,
        vnfInterestReason: parsed.vnfInterestReason,
      });

      // ── Step 4: Display results ─────────────────────────────────────────
      console.log("\n" + "═".repeat(60));
      console.log("📝 BÁO CÁO COMPANY RESEARCH");
      console.log("═".repeat(60));

      if (finalState.finalReport) {
        console.log(finalState.finalReport);
      }

      console.log("─".repeat(60));
      console.log(`📁 File: ${finalState.reportFilePath || "N/A"}`);
      console.log(
        `📊 Research items: ${Object.values(finalState.researchData || {}).flat().length} | ` +
          `Retries: ${finalState.retryCount}`
      );

      if (finalState.missingFields?.length) {
        console.log(
          `⚠️  Fields _Chưa xác minh_: ${finalState.missingFields.join(", ")}`
        );
      }
      console.log("═".repeat(60));
    } catch (error) {
      console.error("❌ Lỗi khi chạy research:", error);
    }

    // Reset cho vòng tiếp theo
    input = "";
    console.log("\n" + "─".repeat(60));
    console.log("🔄 Sẵn sàng research công ty tiếp theo.");
    console.log("─".repeat(60) + "\n");
  }

  rl.close();
}

main();
