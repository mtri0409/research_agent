/**
 * VNF Company Research Agent — LangGraph Graph Definition
 *
 * Pipeline:
 *   START → ask_user → plan_sections → crawl (parallel) → cross_validate
 *   → check_missing → [retry: crawl] → propose_cooperation → write_report → output → END
 *
 * Sử dụng fan-out pattern với Promise.all trong crawl node để tìm kiếm
 * song song nhiều section groups.
 */
import { StateGraph, END, START, Command } from "@langchain/langgraph";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AgentState, AgentStateType, ResearchItem, SectionGroup } from "./state.js";
import { researchTools } from "./tools/research.js";
import { getVNFContextText } from "./tools/vnf.js";
import { renderReport, type ReportData } from "./utils/template.js";
import {
  PLAN_SECTIONS_PROMPT,
  FIELD_CHECKLIST,
  ROUND2_EXTRACT_PROMPT,
  ROUND3_SUMMARIZE_PROMPT,
  CROSS_VALIDATE_PROMPT,
  PROPOSE_COOPERATION_PROMPT,
} from "./prompts.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SEARCH_ROUNDS = 3; // 3 LLM rounds: (1) fetch URLs, (2) deep extract, (3) summarize
const DEFAULT_MAX_RETRIES = 1; // Default nếu không truyền maxRetries qua runResearch()
const CRAWL_CONCURRENCY = 3; // Số group chạy song song tối đa

/** Run async tasks with concurrency limit. */
async function asyncPool<T, R>(concurrency: number, items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();

  async function runOne(i: number, item: T): Promise<void> {
    results[i] = await fn(item);
  }

  for (let i = 0; i < items.length; i++) {
    const p = runOne(i, items[i]).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ─── LLM Client ─────────────────────────────────────────────────────────────

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

// ─── OpenAI Tools Format ────────────────────────────────────────────────────

const openAITools = researchTools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.schema.toJSONSchema() as Record<string, unknown>,
  },
}));

// ─── Message Converters ─────────────────────────────────────────────────────

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAIMessages(messages: BaseMessage[]): ChatMessageParam[] {
  return messages.map((msg): ChatMessageParam => {
    if (msg instanceof HumanMessage) {
      return { role: "user", content: String(msg.content) };
    }

    if (msg instanceof AIMessage) {
      if (msg.tool_calls?.length) {
        return {
          role: "assistant",
          content: msg.content ? String(msg.content) : null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id ?? `call_${tc.name}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args) ?? "{}",
            },
          })),
        };
      }
      return {
        role: "assistant",
        content: msg.content ? String(msg.content) : null,
      };
    }

    if (msg instanceof ToolMessage) {
      return {
        role: "tool",
        tool_call_id: msg.tool_call_id,
        content: String(msg.content),
      };
    }

    return { role: "user", content: String(msg.content) };
  });
}

// ─── LLM Invocation Helpers ─────────────────────────────────────────────────

/**
 * Gọi LLM với tools. Trả về AIMessage (có thể chứa content hoặc tool_calls).
 *
 * @param messages - Danh sách message
 * @param options.toolChoice - "auto" | "required" | "none"
 * @param options.temperature - Nhiệt độ (mặc định 0.3)
 */
async function callLLM(
  messages: BaseMessage[],
  options: {
    toolChoice?: "auto" | "required" | "none";
    temperature?: number;
  } = {}
): Promise<AIMessage> {
  const response = await getLLM().chat.completions.create({
    model: MODEL,
    temperature: options.temperature ?? 0.3,
    messages: toOpenAIMessages(messages),
    tools: openAITools,
    tool_choice: options.toolChoice ?? "auto",
  });

  const msg = response.choices[0]?.message;
  if (!msg) {
    throw new Error("LLM returned empty response.");
  }

  // Normalize content: OpenAI may return string or array of content parts
  const content = Array.isArray(msg.content)
    ? msg.content
        .map((part: any) =>
          typeof part === "string" ? part : part?.text ?? JSON.stringify(part)
        )
        .join("")
    : typeof msg.content === "string"
    ? msg.content
    : msg.content
    ? JSON.stringify(msg.content)
    : "";

  return new AIMessage({
    content,
    tool_calls: msg.tool_calls?.map((tc) => ({
      id: tc.id,
      type: "tool_call" as const,
      name: tc.function.name,
      args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
    })),
  });
}

  /**
   * Mini agent loop cho 1 section group.
   *
   * LUỒNG:
   *   INPUT: mandatoryContent = content từ website chính (pre-fetched)
   *   ROUND 1: LLM dùng mandatoryContent LÀM PRIMARY + tavily_search + fetch_url bổ sung
   *   ROUND 2: DEEP EXTRACTION — trích xuất data point theo FIELD_CHECKLIST
   *   ROUND 3: TỔNG HỢP structured output cuối cùng
   */
async function searchSectionGroup(
  group: SectionGroup,
  companyName: string,
  companyUrl: string | null,
  mandatoryContent: string,
  fetchedUrls?: Set<string>
): Promise<ResearchItem[]> {
  const seenUrls = fetchedUrls || new Set<string>();
  console.log(`\n  ┌─ [${group.groupName}] BẮT ĐẦU ─────────────────────────────`);
  console.log(`  │  Sections: ${group.sections.join(", ")}`);
  console.log(`  │  Queries:  ${group.searchQueries.length} queries`);
  console.log(`  │  Website pre-fetch: ${mandatoryContent ? `${(mandatoryContent.length / 1024).toFixed(1)} KB` : "không có"}`);

  const toolNode = new ToolNode(researchTools);
  const messages: BaseMessage[] = [];

  // ════════════════════════════════════════════════════════════════════
  // ROUND 1: LLM dùng website content (PRIMARY) + tavily_search + fetch_url
  // ════════════════════════════════════════════════════════════════════
  console.log(`  │  🤖 [Round 1/3] FETCH: website content là PRIMARY, gọi tavily_search + fetch_url...`);

  const primarySection = mandatoryContent
    ? [
        `=== WEBSITE CONTENT (PRIMARY SOURCE - đã pre-fetch từ website công ty) ===`,
        mandatoryContent.slice(0, 30000), // Giới hạn 30KB input
        `=== HẾT WEBSITE CONTENT ===`,
      ].join("\n")
    : "(Không có website content — dùng Tavily + fetch_url làm nguồn chính)";

  const round1Msg = [
    `Công ty: **${companyName}**`,
    companyUrl ? `Website: ${companyUrl}` : "",
    "",
    `SECTIONS CẦN ĐIỀN: ${group.sections.join(", ")}`,
    "",
    primarySection,
    "",
    `NHIỆM VỤ:`,
    `1. Website content ở trên là NGUỒN CHÍNH (primary). Đọc kỹ để trích xuất thông tin.`,
    `2. Gọi fetch_url cho các link QUAN TRỌNG từ bên ngoài mà website không có:`,
    `   - LinkedIn company page (thông tin nhân sự, lãnh đạo, năm thành lập)`,
    `   - Crunchbase / PitchBook / Bloomberg (vốn, doanh thu, nhà đầu tư)`,
    `   - Wikipedia (lịch sử, cột mốc, sản phẩm chính)`,
    `   - Trang báo chí uy tín (phân tích, phỏng vấn lãnh đạo)`,
    `3. Gọi tavily_search 2-3 lần để tìm bổ sung:`,
    `   - "${companyName} revenue funding investment financial report"`,
    `   - "${companyName} CEO founder leadership background education"`,
    `   - "${companyName} ISO HACCP GMP BRC certification standards"`,
    `4. KHÔNG fetch lại các URL đã có trong website content.`,
    `5. KHÔNG fetch mạng xã hội (trừ LinkedIn).`,
    ``,
    `QUAN TRỌNG:`,
    `- WEBSITE CONTENT là PRIMARY — mọi thông tin từ website được ưu tiên cao nhất.`,
    `- Tavily + fetch_url dùng để ĐỐI CHIẾU và BỔ SUNG những gì website thiếu.`,
    `- Mỗi lần fetch_url phải là URL MỚI, không trùng với website content.`,
  ].join("\n");

  messages.push(new HumanMessage(round1Msg));

  const resp1 = await callLLM(messages, { toolChoice: "required", temperature: 0.3 });
  messages.push(resp1);

  if (resp1.tool_calls?.length) {
    // Lọc fetch_url trùng lặp giữa các group
    const deduped = resp1.tool_calls.filter((tc) => {
      if (tc.name !== "fetch_url") return true;
      const url = tc.args?.url;
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    if (deduped.length < resp1.tool_calls.length) {
      console.log(`  │  ♻️  Bỏ qua ${resp1.tool_calls.length - deduped.length} tool call(s) trùng URL`);
    }
    resp1.tool_calls = deduped;

    console.log(`  │  🔧 Gọi ${resp1.tool_calls.length} tools:`);
    const fetchCount = resp1.tool_calls.filter((tc) => tc.name === "fetch_url").length;
    const tavilyCount = resp1.tool_calls.filter((tc) => tc.name === "tavily_search").length;
    console.log(`  │     fetch_url: ${fetchCount} links, tavily_search: ${tavilyCount} queries`);

    for (const tc of resp1.tool_calls) {
      const argsStr = JSON.stringify(tc.args);
      console.log(`  │     • ${tc.name}("${argsStr.slice(0, 80)}${argsStr.length > 80 ? "..." : ""}")`);
    }

    const toolResult = await toolNode.invoke({ messages: [resp1] });
    const toolMessages = toolResult.messages.filter(
      (m: BaseMessage) => m instanceof ToolMessage
    ) as ToolMessage[];

    let fetchedChars = 0;
    for (const tm of toolMessages) {
      const contentStr = String(tm.content);
      fetchedChars += contentStr.length;
      const hasContent =
        contentStr.length > 50 &&
        !contentStr.startsWith("Lỗi") &&
        !contentStr.startsWith("Không thể");
      console.log(
        `  │  ${hasContent ? "✅" : "⚠️"} ${tm.name || tm.tool_call_id}: ` +
          `"${contentStr.slice(0, 100)}${contentStr.length > 100 ? "..." : ""}"`
      );
    }
    console.log(`  │  📊 Tổng dữ liệu fetch: ~${(fetchedChars / 1024).toFixed(1)} KB`);
    messages.push(...toolMessages);
  } else {
    console.log(`  │  ⚠️  LLM không gọi tool nào!`);
  }

  // ════════════════════════════════════════════════════════════════════
  // ROUND 2: DEEP EXTRACTION (tool_choice="auto")
  // ════════════════════════════════════════════════════════════════════
  console.log(`  │  🔬 [Round 2/3] EXTRACT: trích xuất data point theo checklist...`);

  // Build checklist cho các section của group này
  const checklistParts: string[] = [];
  for (const section of group.sections) {
    const checklist = FIELD_CHECKLIST[section];
    if (checklist) {
      checklistParts.push(`\n### ${section}\n${checklist}`);
    } else {
      checklistParts.push(`\n### ${section}\n(Tự xác định các field cần tìm)`);
    }
  }
  const checklistText = checklistParts.join("\n");

  const round2Msg = ROUND2_EXTRACT_PROMPT.replace("{checklist}", checklistText);

  messages.push(new HumanMessage(round2Msg));

  const resp2 = await callLLM(messages, { toolChoice: "auto", temperature: 0.3 });
  messages.push(resp2);

  // Nếu LLM gọi thêm tool ở round 2 → execute
  if (resp2.tool_calls?.length) {
    const deduped2 = resp2.tool_calls.filter((tc) => {
      if (tc.name !== "fetch_url") return true;
      const url = tc.args?.url;
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
    if (deduped2.length < resp2.tool_calls.length) {
      console.log(`  │  ♻️  Bỏ qua ${resp2.tool_calls.length - deduped2.length} tool call(s) trùng URL`);
    }
    resp2.tool_calls = deduped2;

    console.log(`  │  🔧 Gọi thêm ${resp2.tool_calls.length} tools bổ sung`);
    for (const tc of resp2.tool_calls) {
      const argsStr = JSON.stringify(tc.args);
      console.log(`  │     • ${tc.name}("${argsStr.slice(0, 80)}${argsStr.length > 80 ? "..." : ""}")`);
    }
    const toolResult2 = await toolNode.invoke({ messages: [resp2] });
    const toolMessages2 = toolResult2.messages.filter(
      (m: BaseMessage) => m instanceof ToolMessage
    ) as ToolMessage[];
    for (const tm of toolMessages2) {
      const contentStr = String(tm.content);
      console.log(
        `  │     → "${contentStr.slice(0, 100)}${contentStr.length > 100 ? "..." : ""}"`
      );
    }
    messages.push(...toolMessages2);
  }

  // Log LLM response từ round 2
  if (resp2.content) {
    const c = String(resp2.content);
    console.log(`  │  💬 Extract response: "${c.slice(0, 120)}${c.length > 120 ? "..." : ""}"`);
  }

  // ════════════════════════════════════════════════════════════════════
  // ROUND 3: TỔNG HỢP (tool_choice="none")
  // ════════════════════════════════════════════════════════════════════
  console.log(`  │  📝 [Round 3/3] SUMMARIZE: tổng hợp structured output...`);

  const round3Msg = [
    ROUND3_SUMMARIZE_PROMPT,
    "",
    `Công ty: ${companyName}`,
    `Sections cần output: ${group.sections.join(", ")}`,
    "",
    `Tổng hợp TẤT CẢ dữ liệu đã thu thập ở các vòng trên.`,
    `Trả về đúng format RESEARCH RESULTS như hướng dẫn.`,
  ].join("\n");

  messages.push(new HumanMessage(round3Msg));

  const resp3 = await callLLM(messages, { toolChoice: "none", temperature: 0.2 });
  messages.push(resp3);

  const finalContent = resp3.content ? String(resp3.content) : "";
  console.log(`  │  📏 Final response: ${finalContent.length} chars`);

  // Parse structured output
  const collectedItems = parseResearchResults(finalContent, group.sections);

  if (collectedItems.length > 0) {
    console.log(`  │  📋 Parse được ${collectedItems.length} items:`);
    // Group by section
    const bySection: Record<string, number> = {};
    for (const item of collectedItems) {
      bySection[item.section] = (bySection[item.section] || 0) + 1;
    }
    for (const [sec, count] of Object.entries(bySection)) {
      console.log(`  │     • [${sec}]: ${count} fields`);
    }
    // Show first 3 samples
    for (const item of collectedItems.slice(0, 3)) {
      console.log(
        `  │     Sample: [${item.section}] ${item.title}: "${item.content.slice(0, 80)}..."`
      );
    }
  }

  // Fallback
  if (collectedItems.length === 0) {
    console.log("  │  ⚠️  Không parse được, dùng raw response.");
    for (const section of group.sections) {
      collectedItems.push({
        section,
        content: finalContent.slice(0, 3000),
        source: companyUrl || "web search",
        title: `${group.groupName} - ${section}`,
      });
    }
  }

  // Tổng kết
  const sectionsFound = [...new Set(collectedItems.map((i) => i.section))];
  const sectionsMissing = group.sections.filter(
    (s) => !sectionsFound.some((f) => f.toLowerCase() === s.toLowerCase())
  );
  const foundCount = collectedItems.filter(
    (i) => !i.content.includes("KHÔNG TÌM THẤY") && !i.content.includes("_Chưa xác minh_")
  ).length;
  const missingCount = collectedItems.length - foundCount;

  console.log(
    `  ├─ 📊 Tổng kết: ${collectedItems.length} fields (✅ ${foundCount} tìm thấy, ❌ ${missingCount} thiếu)`
  );
  console.log(`  ├─ Sections có data: ${sectionsFound.length}/${group.sections.length}`);
  if (sectionsMissing.length > 0) {
    console.log(`  ├─ ⚠️  Sections thiếu: ${sectionsMissing.join(", ")}`);
  }
  console.log(`  └─ [${group.groupName}] KẾT THÚC ─────────────────────────────`);

  return collectedItems;
}

/**
 * Parse kết quả research từ LLM output thành ResearchItem[].
 * Hỗ trợ 2 formats:
 * 1. JSON array mới: [{ section, field, value, sources }]
 * 2. Text cũ: SECTION: / FIELD: / VALUE: / SOURCE:
 */
function parseResearchResults(text: string, sections: string[]): ResearchItem[] {
  const items: ResearchItem[] = [];
  const sectionSet = new Set(sections.map((s) => s.toLowerCase()));

  // Thử parse JSON array trước
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        for (const obj of parsed) {
          const section = String(obj.section || "").trim();
          const field = String(obj.field || "").trim();
          const value = String(obj.value || "").trim();
          const sources = Array.isArray(obj.sources)
            ? obj.sources.map(String).filter((s: string) => s && !s.toLowerCase().startsWith("_"))
            : [];

          if (!section || !value) continue;
          if (sections.length > 0 && !sectionSet.has(section.toLowerCase())) continue;

          items.push({
            section,
            content: field ? `**${field}**: ${value}` : value,
            source: sources[0] || "unknown",
            title: field || section,
          });

          // Add remaining sources as duplicate items so validator can see multi-source
          for (let i = 1; i < sources.length; i++) {
            items.push({
              section,
              content: field ? `**${field}**: ${value}` : value,
              source: sources[i],
              title: field || section,
            });
          }
        }
        if (items.length > 0) return items;
      }
    }
  } catch {
    // fall through to text parser
  }

  // Fallback: text parser
  const blocks = text.split(/(?=SECTION:)/i);
  for (const block of blocks) {
    const sectionMatch = block.match(/SECTION:\s*(.+)/i);
    const fieldMatch = block.match(/FIELD:\s*(.+)/i);
    const valueMatch = block.match(/VALUE:\s*([\s\S]*?)(?=SOURCE:|FIELD:|SECTION:|$)/i);
    const sourceMatch = block.match(/SOURCE:\s*(.+)/i);

    const section = sectionMatch?.[1]?.trim() || sections[0] || "Unknown";
    const field = fieldMatch?.[1]?.trim() || "";
    const value = valueMatch?.[1]?.trim() || block.slice(0, 1000);
    const source = sourceMatch?.[1]?.trim() || "unknown";

    if (sectionSet.has(section.toLowerCase()) || sections.length === 0) {
      items.push({
        section,
        content: field ? `**${field}**: ${value}` : value,
        source,
        title: field || section,
      });
    }
  }

  return items;
}

// ─── Tool Executor ──────────────────────────────────────────────────────────

const toolNode = new ToolNode(researchTools);

// ─── Nodes ──────────────────────────────────────────────────────────────────

/**
 * Node 1: ask_user
 *
 * Kiểm tra xem đã có outputLanguage và vnfInterestReason chưa.
 * Nếu chưa → dùng interrupt() để hỏi người dùng.
 * Nếu có rồi → đi tiếp.
 *
 * NOTE: Hiện tại xử lý ask_user ở tầng index.ts trước khi invoke graph,
 * để tránh phức tạp của interrupt() API. Node này chỉ validate.
 */
async function askUserNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { companyName, companyUrl, outputLanguage, vnfInterestReason } = state;

  // Nếu đã có đủ thông tin → đi tiếp
  if (outputLanguage && vnfInterestReason) {
    console.log(`✅ Đầy đủ thông tin: ngôn ngữ=${outputLanguage}, lý do=${vnfInterestReason}`);
    return {};
  }

  // Thiếu thông tin → cần interrupt (xử lý ở index.ts)
  console.log("⏸️  Cần thêm thông tin từ người dùng (ngôn ngữ + lý do VNF quan tâm)");
  return {};
}

/**
 * Node 2: plan_sections
 *
 * Dùng LLM để chia các section trong template thành 3-4 nhóm,
 * mỗi nhóm có search queries riêng để tìm kiếm song song.
 */
async function planSectionsNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  console.log("\n📋 [Plan] ────────────────────────────────────────────");

  const { companyName, companyUrl } = state;
  console.log(`  🎯 Công ty: ${companyName}${companyUrl ? ` | URL: ${companyUrl}` : ""}`);

  const prompt = `${PLAN_SECTIONS_PROMPT}\n\nCông ty: ${companyName}${companyUrl ? `\nWebsite: ${companyUrl}` : ""}`;

  console.log(`  ⏳ LLM đang phân tích và chia nhóm section...`);
  const t0 = Date.now();

  const response = await callLLM([new HumanMessage(prompt)], {
    toolChoice: "none",
    temperature: 0.2,
  });

  console.log(`  ✅ Hoàn thành sau ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const content = String(response.content || "");
  let sectionPlan: SectionGroup[] = [];
  let isNgoDetected = false;

  try {
    // Try parsing JSON from response (có thể bọc trong ```json ... ```)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);

    // Hỗ trợ format mới { isNgo, groups } hoặc format cũ là array
    const groups = Array.isArray(parsed) ? parsed : parsed.groups;
    isNgoDetected = parsed.isNgo === true;

    if (Array.isArray(groups) && groups.length > 0) {
      sectionPlan = groups.map((g: any) => ({
        groupName: String(g.groupName || ""),
        sections: Array.isArray(g.sections) ? g.sections.map(String) : [],
        searchQueries: Array.isArray(g.searchQueries) ? g.searchQueries.map(String) : [],
      }));
    }
  } catch {
    // Fallback: tạo plan mặc định
    console.warn("⚠️  Không parse được JSON plan, dùng default.");
    sectionPlan = getDefaultSectionPlan(companyName, state.vnfInterestReason);
  }

  if (!sectionPlan.length) {
    sectionPlan = getDefaultSectionPlan(companyName, state.vnfInterestReason);
  }

  console.log(`  → Chia thành ${sectionPlan.length} nhóm section:`);
  for (const g of sectionPlan) {
    console.log(`    • ${g.groupName}: ${g.sections.join(", ")}`);
  }

  return { sectionPlan, isNgo: isNgoDetected };
}

/** Default section plan với targeted queries NHẮM ĐÚNG NGUỒN */
function getDefaultSectionPlan(companyName: string, reason?: string): SectionGroup[] {
  const isNgo = /NGO|non-profit|phi lợi nhuận|viện nghiên cứu|institute|foundation|quỹ|organization/i.test(
    reason || ""
  );

  const base = [
    {
      groupName: "A: Tổng quan & Lãnh đạo",
      sections: ["THÔNG TIN CHUNG", "LÃNH ĐẠO"],
      searchQueries: [
        `${companyName} company overview founded history employees revenue`,
        `site:crunchbase.com ${companyName}`,
        `site:linkedin.com/company ${companyName}`,
        `${companyName} CEO founder leadership background education`,
        `${companyName} leadership team board of directors`,
        `${companyName} ownership shareholders investors funding`,
        `${companyName} Wikipedia company profile`,
      ],
    },
    {
      groupName: "C: Thị trường & Bền vững",
      sections: ["HOẠT ĐỘNG KINH DOANH", "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG", "BỀN VỮNG VÀ MÔI TRƯỜNG", "HIGHLIGHT CÔNG TY"],
      searchQueries: [
        `${companyName} market customers export distribution channels`,
        `${companyName} ISO HACCP GMP BRC IFS certification quality standards`,
        `${companyName} sustainability CSR environmental ESG report`,
        `${companyName} awards achievements recognition prize`,
        `${companyName} competitive advantage unique selling point`,
        `${companyName} revenue growth market share financial report`,
        `${companyName} partners retailers distributors clients`,
      ],
    },
  ];

  if (isNgo) {
    return [
      ...base,
      {
        groupName: "B: Dự án & Hoạt động",
        sections: ["CÁC DỰ ÁN ĐÃ TRIỂN KHAI", "CHUỖI GIÁ TRỊ"],
        searchQueries: [
          `${companyName} programs projects initiatives beneficiaries`,
          `${companyName} annual report impact report`,
          `${companyName} partnerships donors grants`,
          `${companyName} United Way alliance projects`,
        ],
      },
    ];
  }

  return [
    ...base,
    {
      groupName: "B: Sản xuất & Sản phẩm",
      sections: ["NHÀ MÁY", "DANH MỤC SẢN PHẨM", "CHUỖI GIÁ TRỊ"],
      searchQueries: [
        `${companyName} factory manufacturing facility location capacity`,
        `${companyName} products catalog brands portfolio SKU`,
        `${companyName} product lines categories ingredients`,
        `${companyName} supply chain raw materials sourcing`,
        `${companyName} quality control production process`,
        `${companyName} OEM ODM private label manufacturing`,
      ],
    },
  ];
}

/**
 * Sinh danh sách URL CỤ THỂ cần fetch từ website công ty.
 * Dựa trên SKILL.md dòng 39-43; mở rộng thêm prefix ngôn ngữ và path tiếng Việt phổ biến.
 */
function generateCrawlUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, "");

  const langs = ["", "/en", "/vi"];

  const pathGroups = [
    ["/about", "/about-us", "/company", "/our-story", "/gioi-thieu", "/ve-chung-toi"],
    ["/team", "/leadership", "/management", "/board", "/who-we-are", "/nhan-su", "/doi-ngu", "/quan-ly"],
    ["/products", "/brands", "/portfolio", "/solutions", "/san-pham", "/dich-vu", "/hang-hoa"],
    ["/contact", "/factory", "/sustainability", "/news", "/press", "/lien-he", "/nha-may", "/ben-vung", "/tin-tuc", "/trach-nhiem-xa-hoi"],
  ];

  const paths = new Set<string>();
  paths.add(""); // trang chủ

  for (const lang of langs) {
    for (const group of pathGroups) {
      for (const p of group) {
        paths.add(`${lang}${p}`);
      }
    }
  }

  return Array.from(paths).map((p) => `${base}${p}`);
}

/**
 * Extract internal links từ HTML, giới hạn trong cùng hostname/base path.
 */
function extractInternalLinks(baseUrl: string, html: string): string[] {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl).href;
      const parsed = new URL(resolved);
      if (parsed.hostname === base.hostname) {
        parsed.hash = "";
        parsed.search = "";
        links.add(parsed.href);
      }
    } catch {
      // ignore invalid URL
    }
  });

  return Array.from(links);
}

/**
 * Strip HTML noise bằng cheerio: bỏ script/style/nav/header/footer/aside,
 * ưu tiên main/article/section, rồi lấy text.
 */
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, nav, header, footer, aside, .menu, .navbar, .sidebar, .cookie-banner, .popup").remove();

  // Try semantic containers first; fallback to body
  let content = $("main, article, [role='main']").first().text();
  if (!content || content.trim().length < 200) {
    content = $("body").text();
  }

  return content
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect JS-rendered / empty / anti-bot shell pages. */
function isJsRendered(rawHtml: string, text: string): boolean {
  const firstWords = text.slice(0, 150).toLowerCase();
  const shellPatterns = [
    "loading",
    "spinner",
    "just a moment",
    "enable javascript",
    "please enable js",
    "noscript",
    "please wait",
    "redirecting",
    "checking your browser",
    "cloudflare",
    "captcha",
    "turn on javascript",
  ];
  if (shellPatterns.some((p) => firstWords.includes(p))) return true;

  // Common SPA indicators with very little visible text
  const spaIndicators = [
    'id="root"',
    'id="__next"',
    'id="__nuxt"',
    'id="app"',
    "__NEXT_DATA__",
    "window.__NUXT__",
    "window.__INITIAL_STATE__",
  ];
  if (spaIndicators.some((m) => rawHtml.toLowerCase().includes(m.toLowerCase())) && text.trim().length < 300) {
    return true;
  }

  // Very little text but lots of JS = likely SPA shell
  const scriptBytes = (rawHtml.match(/<script[\s\S]*?<\/script>/gi) || []).join("").length;
  const bodyBytes = rawHtml.length;
  if (text.length < 200 && bodyBytes > 5000 && scriptBytes / bodyBytes > 0.15) return true;

  return false;
}

/** Extract JSON-LD and Next.js data as fallback text for JS-rendered pages. */
function extractStructuredDataFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];

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

/** Xếp hạng URL theo độ ưu tiên dựa trên path keywords */
function scoreUrlByPriority(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  const priorityKeywords = [
    // About / company info
    [
      "/about", "/about-us", "/company", "/our-story", "/gioi-thieu",
      "/ve-chung-toi", "/tong-quan", "/intro",
    ],
    // Leadership
    [
      "/team", "/leadership", "/management", "/board", "/who-we-are",
      "/nhan-su", "/doi-ngu", "/quan-ly", "/ban-lanh-dao",
    ],
    // Products
    [
      "/products", "/brands", "/portfolio", "/solutions", "/san-pham",
      "/dich-vu", "/hang-hoa", "/product", "/brand",
    ],
    // Contact / factory / sustainability / news
    [
      "/contact", "/factory", "/sustainability", "/news", "/press",
      "/lien-he", "/nha-may", "/ben-vung", "/tin-tuc",
      "/trach-nhiem-xa-hoi", "/csr", "/esg",
    ],
  ];

  for (let groupIdx = 0; groupIdx < priorityKeywords.length; groupIdx++) {
    for (const kw of priorityKeywords[groupIdx]) {
      if (path === kw || path.startsWith(`${kw}/`)) {
        // Ưu tiên group đầu cao hơn, trong cùng group thì path ngắn hơn
        return (priorityKeywords.length - groupIdx) * 1000 + Math.max(0, 500 - path.length);
      }
    }
  }
  return 0;
}

/**
 * Fetch hàng loạt URL và trả về nội dung text đã strip HTML.
 * Có JS-rendered detection: nếu response là shell rỗng → gắn cờ [JS-RENDERED].
 * Ưu tiên extract internal links từ trang chủ thay vì chỉ hard-code paths.
 */
async function preFetchWebsite(urls: string[]): Promise<{
  content: string;
  jsRendered: string[];
  fetched: number;
  failed: number;
  urlsTried: string[];
}> {
  const jsRendered: string[] = [];
  const urlsTried: string[] = [];
  let fetched = 0;
  let failed = 0;

  // STEP 1: Fetch trang chủ để extract links
  const baseUrl = urls[0];
  let discoveredUrls: string[] = [];
  try {
    const homeResp = await fetch(baseUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (homeResp.ok) {
      const homeHtml = await homeResp.text();
      discoveredUrls = extractInternalLinks(baseUrl, homeHtml);
      // Thử sitemap
      try {
        const sitemapUrl = new URL("/sitemap.xml", baseUrl).href;
        const sitemapResp = await fetch(sitemapUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(10000),
        });
        if (sitemapResp.ok) {
          const sitemapText = await sitemapResp.text();
          const locMatches = sitemapText.match(/<loc>([^<]+)<\/loc>/g);
          if (locMatches) {
            for (const loc of locMatches) {
              const urlMatch = loc.match(/<loc>([^<]+)<\/loc>/);
              if (urlMatch) {
                try {
                  const u = new URL(urlMatch[1]);
                  if (u.hostname === new URL(baseUrl).hostname) {
                    u.hash = "";
                    u.search = "";
                    discoveredUrls.push(u.href);
                  }
                } catch {}
              }
            }
          }
        }
      } catch {
        // ignore sitemap errors
      }
    }
  } catch {
    // ignore home fetch error, fall back to provided urls
  }

  // STEP 2: Merge discovered URLs with provided URLs, deduplicate, score & limit
  const allCandidateUrls = Array.from(new Set([...urls, ...discoveredUrls]));
  const scoredUrls = allCandidateUrls
    .map((url) => ({ url, score: scoreUrlByPriority(url) }))
    .sort((a, b) => b.score - a.score);

  // Giữ top 30 URL ưu tiên cao nhất + trang chủ
  const homepageUrl = baseUrl.replace(/\/+$/, "");
  const topUrlsSet = new Set<string>([homepageUrl]);
  for (const { url } of scoredUrls) {
    if (topUrlsSet.size >= 30) break;
    topUrlsSet.add(url);
  }
  const topUrls = Array.from(topUrlsSet);

  // STEP 3: Fetch all selected URLs
  const results = await Promise.all(
    topUrls.map(async (url) => {
      urlsTried.push(url);
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
          failed++;
          return `[HTTP ${resp.status}] ${url}`;
        }

        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
          failed++;
          return `[NOT_HTML: ${contentType}] ${url}`;
        }

        const html = await resp.text();

        const strippedHtml = extractTextFromHtml(html);

        if (strippedHtml.length < 300 || isJsRendered(html, strippedHtml)) {
          jsRendered.push(url);
          fetched++;

          // Fallback: lấy JSON-LD / Next.js data trước khi bỏ cuộc
          const structured = extractStructuredDataFromHtml(html);
          if (structured) {
            return `### FETCH: ${url}\n[JS-RENDERED - structured data fallback]\n${structured.slice(0, 4000)}`;
          }

          return `[JS-RENDERED - cần browser] ${url} (chỉ thấy shell ${strippedHtml.length} chars: "${strippedHtml.slice(0, 100)}...")`;
        }

        fetched++;
        return `### FETCH: ${url}\n${strippedHtml.slice(0, 4000)}`;
      } catch (e: any) {
        failed++;
        if (e.name === "AbortError" || e.name === "TimeoutError") {
          return `[TIMEOUT] ${url}`;
        }
        return `[ERROR] ${url}: ${e.message?.slice(0, 100)}`;
      }
    })
  );

  return {
    content: results.join("\n\n"),
    jsRendered,
    fetched,
    failed,
    urlsTried,
  };
}

/**
 * Node 3: crawl (song song)
 *
 * STEP 0: Pre-fetch TẤT CẢ mandatory URL từ website công ty (CHẠY 1 LẦN).
 * STEP 1: Fan-out searchSectionGroup — các group NHẬN pre-fetched content làm PRIMARY.
 *
 * Flow theo SKILL.md: 2a (fetch website) → 2b (search bổ sung).
 */
async function crawlNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { sectionPlan, companyName, companyUrl } = state;

  if (!sectionPlan.length) {
    console.warn("⚠️  Không có section plan, bỏ qua crawl.");
    return { researchData: {} };
  }

  console.log(`\n🔍 [Crawl] Bắt đầu research ${sectionPlan.length} nhóm section...`);
  for (const g of sectionPlan) {
    console.log(`  📦 ${g.groupName}: ${g.sections.length} sections, ${g.searchQueries.length} queries`);
  }

  // ════════════════════════════════════════════════════════════════════
  // STEP 0: Fetch website chính TRƯỚC (SKILL.md 2a) — CHẠY 1 LẦN DUY NHẤT
  // ════════════════════════════════════════════════════════════════════
  let mandatoryContent = "";
  let jsRenderedUrls: string[] = [];

  if (companyUrl) {
    const urls = generateCrawlUrls(companyUrl);
    console.log(`\n  🌐 [2a - Fetch Website] Crawl ${urls.length} URL từ ${companyUrl}...`);
    const startFetch = Date.now();

    const fetchResult = await preFetchWebsite(urls);
    mandatoryContent = fetchResult.content;
    jsRenderedUrls = fetchResult.jsRendered;

    console.log(
      `  ✅ Fetch xong: ${fetchResult.fetched} OK, ${fetchResult.failed} lỗi trong ${((Date.now() - startFetch) / 1000).toFixed(1)}s ` +
      `(${(mandatoryContent.length / 1024).toFixed(1)} KB)`
    );

    if (jsRenderedUrls.length > 0) {
      console.log(
        `  ⚠️  JS-Rendered (${jsRenderedUrls.length} URL cần browser): ${jsRenderedUrls.slice(0, 3).join(", ")}${jsRenderedUrls.length > 3 ? "..." : ""}`
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // STEP 1: FAN-OUT — search song song các group (SKILL.md 2b)
  // Mỗi group nhận mandatoryContent làm PRIMARY SOURCE
  // ════════════════════════════════════════════════════════════════════
  console.log(`\n  🔬 [2b - Search Bổ Sung] Fan-out ${sectionPlan.length} nhóm...`);
  const startTime = Date.now();

  const fetchedUrls = new Set<string>();
  const results = await asyncPool(
    CRAWL_CONCURRENCY,
    sectionPlan,
    (group) => searchSectionGroup(group, companyName, companyUrl, mandatoryContent, fetchedUrls)
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ✅ Hoàn thành ${sectionPlan.length} nhóm trong ${elapsed}s`);

  // Merge kết quả vào researchData
  const researchData: Record<string, ResearchItem[]> = {};
  for (let i = 0; i < sectionPlan.length; i++) {
    const group = sectionPlan[i];
    const items = results[i];
    console.log(`  📋 [${group.groupName}]: ${items.length} items`);
    for (const section of group.sections) {
      const sectionItems = items.filter(
        (item) => item.section.toLowerCase() === section.toLowerCase()
      );
      if (sectionItems.length > 0) {
        researchData[section] = [
          ...(researchData[section] || []),
          ...sectionItems,
        ];
        console.log(`     ✅ ${section}: ${sectionItems.length} items`);
      } else {
        console.log(`     ❌ ${section}: KHÔNG có data`);
      }
    }
  }

  // Stats
  const totalItems = Object.values(researchData).flat().length;
  const sectionsWithData = Object.keys(researchData).length;
  const allSections = sectionPlan.flatMap((g) => g.sections);
  const sectionsWithoutData = allSections.filter(
    (s) => !researchData[s] || researchData[s].length === 0
  );
  console.log(`\n  📊 Tổng: ${totalItems} items từ ${sectionsWithData}/${allSections.length} sections`);
  if (sectionsWithoutData.length > 0) {
    console.log(`  ⚠️  Chưa có data: ${sectionsWithoutData.join(", ")}`);
  }

  return { researchData };
}

/**
 * Node 4: cross_validate
 *
 * LLM đối chiếu dữ liệu từ nhiều nguồn, gán confidence, flag missing fields.
 */
async function crossValidateNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { researchData, companyName } = state;

  // ── Check input ──────────────────────────────────────────────────────
  const totalSections = Object.keys(researchData).length;
  const totalItems = Object.values(researchData).flat().length;

  console.log(`\n🔬 [Validate] ────────────────────────────────────────────`);
  console.log(`  📥 Input: ${totalSections} sections, ${totalItems} research items`);

  if (totalItems === 0) {
    console.warn(`  ⚠️  KHÔNG có dữ liệu research nào để đối chiếu!`);
    return { validatedFacts: {}, missingFields: [], isNgo: false };
  }

  // Log tóm tắt từng section
  for (const [section, items] of Object.entries(researchData)) {
    const sources = [...new Set(items.map((i) => i.source))];
    console.log(`     • ${section}: ${items.length} items từ ${sources.length} nguồn`);
    if (items.length > 0 && items.length <= 5) {
      for (const item of items) {
        console.log(`       └ "${item.title || "untitled"}": ${item.content.slice(0, 80)}...`);
      }
    }
  }

  // ── Format data + gọi LLM ───────────────────────────────────────────
  const dataText = formatResearchDataForValidation(researchData);
  console.log(`  📤 Gửi ${(dataText.length / 1024).toFixed(1)} KB dữ liệu cho LLM đối chiếu...`);
  console.log(`  ⏳ Đang chờ LLM phản hồi (có thể mất 10-30s)...`);

  const startTime = Date.now();
  const response = await callLLM(
    [
      new HumanMessage(
        `${CROSS_VALIDATE_PROMPT}\n\n---\nCÔNG TY: ${companyName}\n\nDỮ LIỆU THÔ:\n\n${dataText}\n\n---\nHãy đối chiếu và trả về JSON với validatedFacts và missingFields.`
      ),
    ],
    { toolChoice: "none", temperature: 0.1 }
  );
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const content = String(response.content || "");
  console.log(`  📥 LLM trả lời sau ${elapsed}s: ${content.length} chars`);
  console.log(`     Preview: "${content.slice(0, 150)}${content.length > 150 ? "..." : ""}"`);

  // ── Parse JSON ──────────────────────────────────────────────────────
  let validatedFacts: Record<string, any[]> = {};
  let missingFields: string[] = [];
  let isNgo = state.isNgo || false;

  try {
    const jsonMatch =
      content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);
    validatedFacts = parsed.validatedFacts || {};
    missingFields = parsed.missingFields || [];
    isNgo = state.isNgo || parsed.isNgo || false;
    console.log(`  📋 JSON parsed OK: ${Object.keys(validatedFacts).length} sections`);
  } catch (e: any) {
    console.warn(`  ⚠️  Không parse được JSON (${e.message?.slice(0, 60)}), dùng raw data fallback.`);
    for (const [section, items] of Object.entries(researchData)) {
      validatedFacts[section] = items.map((item) => ({
        field: item.title || section,
        value: item.content,
        sources: [item.source],
        confidence: "partial" as const,
      }));
    }
  }

  // ── Enforce source rules: chỉ đánh dấu _Chưa xác minh_ khi thực sự không có dữ liệu/nguồn ───────────────────────────────────────────
  let downgradedCount = 0;
  for (const facts of Object.values(validatedFacts)) {
    for (const fact of facts as any[]) {
      const hasNoValue =
        !fact.value ||
        String(fact.value).trim() === "" ||
        String(fact.value).trim().toLowerCase() === "_chưa xác minh_";
      const hasNoSource = !fact.sources || fact.sources.length === 0;

      if (hasNoValue || hasNoSource) {
        if (!hasNoValue) downgradedCount++;
        fact.value = "_Chưa xác minh_";
        fact.confidence = "unverified";
        continue;
      }

      // Normalize confidence: 1 source = partial, >=2 = verified
      if (fact.sources.length === 1 && fact.confidence === "verified") {
        fact.confidence = "partial";
      }
    }
  }
  if (downgradedCount > 0) {
    console.log(`  🔒 Facts không có nguồn: ${downgradedCount} đổi thành "_Chưa xác minh_"`);
  }

  const totalFacts = Object.values(validatedFacts).flat().length;
  console.log(`  ✅ Tổng: ${totalFacts} facts validated`);

  // ── Log chi tiết từng section ───────────────────────────────────────
  for (const [section, facts] of Object.entries(validatedFacts)) {
    const verified = facts.filter((f: any) => f.confidence === "verified").length;
    const partial = facts.filter((f: any) => f.confidence === "partial").length;
    const unverified = facts.filter((f: any) => f.confidence === "unverified").length;

    console.log(
      `     📋 ${section}: ${facts.length} facts ` +
      `(✅verified: ${verified}, 📎partial: ${partial}, ❌unverified: ${unverified})`
    );

    // Log 2-3 field samples với confidence
    const samples = facts.slice(0, 3) as any[];
    for (const f of samples) {
      const icon = f.confidence === "verified" ? "✅" : f.confidence === "partial" ? "📎" : "❌";
      const val = String(f.value || "").slice(0, 80);
      console.log(`        ${icon} [${f.field || "?"}] = "${val}"`);
    }
  }

  // ── Missing fields ──────────────────────────────────────────────────
  if (missingFields.length > 0) {
    console.log(`  ⚠️  MISSING (${missingFields.length} fields):`);
    for (const f of missingFields.slice(0, 10)) {
      console.log(`     • ${f}`);
    }
    if (missingFields.length > 10) {
      console.log(`     ... và ${missingFields.length - 10} fields nữa`);
    }
  } else {
    console.log(`  ✅ KHÔNG có field nào thiếu`);
  }

  if (isNgo) {
    console.log(`  🏛️  Phát hiện NGO → dùng template NGO`);
  }

  console.log(`  ─────────────────────────────────────────────────────────`);

  return { validatedFacts, missingFields, isNgo };
}

/** Format researchData thành text dễ đọc cho LLM validation */
function formatResearchDataForValidation(
  data: Record<string, ResearchItem[]>
): string {
  const parts: string[] = [];
  for (const [section, items] of Object.entries(data)) {
    parts.push(`\n### ${section}`);
    for (const item of items) {
      parts.push(`- [${item.title || "Fact"}](${item.source}): ${item.content.slice(0, 500)}`);
    }
  }
  return parts.join("\n");
}

/**
 * Node 5: check_missing (Router)
 *
 * Nếu còn missing fields và retryCount < maxRetries (từ state, fallback DEFAULT_MAX_RETRIES)
 * → quay lại crawl với targeted search.
 * Ngược lại → đi tiếp propose_cooperation.
 *
 * FIX: đọc limit từ state.maxRetries thay vì hardcode module constant —
 * trước đây state.maxRetries được set khi init nhưng KHÔNG hề được đọc ở đây,
 * nên đổi giá trị đó qua runResearch() không có tác dụng gì.
 */
function checkMissingRouter(state: AgentStateType): "retry_crawl" | "propose" {
  const { missingFields, retryCount, maxRetries } = state;
  const limit = typeof maxRetries === "number" ? maxRetries : DEFAULT_MAX_RETRIES;

  console.log(`\n🔀 [Router] Kiểm tra missing fields...`);
  console.log(`  Missing: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}`);
  console.log(`  Retry:   ${retryCount}/${limit}`);

  if (missingFields.length > 0 && retryCount < limit) {
    console.log(
      `  → QUAY LẠI crawl targeted (lần ${retryCount + 1})`
    );
    return "retry_crawl";
  }

  if (missingFields.length > 0) {
    console.log(
      `  → HẾT RETRY, chấp nhận ${missingFields.length} field _Chưa xác minh_, đi tiếp đề xuất`
    );
  } else {
    console.log("  → ĐẦY ĐỦ, đi tiếp đề xuất hợp tác");
  }

  return "propose";
}

/**
 * Map field name còn thiếu → section đúng, dùng cho retryCrawlNode.
 *
 * FIX (bug chính): bản cũ so sánh `normalized` (đã strip dấu tiếng Việt qua NFD)
 * với các key trong `sectionByKeyword` NHƯNG nhiều key đó (NHÂNMÁY, SẢNPHẨM,
 * KHÁCHHÀNG, BỀNVỮNG, CHUỖIGIÁTRỊ...) vẫn còn giữ dấu → `normalized.includes(kw)`
 * gần như không bao giờ match cho các field tiếng Việt, khiến chúng rơi vào
 * fallback sai ("THÔNG TIN CHUNG"). Bản này normalize CẢ 2 phía (field lẫn key)
 * bằng cùng 1 hàm, tránh lệch tay khi thêm/sửa key sau này.
 */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

const SECTION_BY_KEYWORD_RAW: Record<string, string> = {
  "LÃNH ĐẠO": "LÃNH ĐẠO",
  CEO: "LÃNH ĐẠO",
  CFO: "LÃNH ĐẠO",
  COO: "LÃNH ĐẠO",
  CTO: "LÃNH ĐẠO",
  "CHỦ TỊCH": "LÃNH ĐẠO",
  LEADERSHIP: "LÃNH ĐẠO",
  "NHÀ MÁY": "NHÀ MÁY",
  FACTORY: "NHÀ MÁY",
  "SẢN PHẨM": "DANH MỤC SẢN PHẨM",
  PRODUCTS: "DANH MỤC SẢN PHẨM",
  "KHÁCH HÀNG": "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG",
  CUSTOMERS: "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG",
  "BỀN VỮNG": "BỀN VỮNG VÀ MÔI TRƯỜNG",
  SUSTAINABILITY: "BỀN VỮNG VÀ MÔI TRƯỜNG",
  "CHUỖI GIÁ TRỊ": "CHUỖI GIÁ TRỊ",
  HIGHLIGHT: "HIGHLIGHT CÔNG TY",
  AWARDS: "HIGHLIGHT CÔNG TY",
  "DỰ ÁN": "CÁC DỰ ÁN ĐÃ TRIỂN KHAI",
  PROJECT: "CÁC DỰ ÁN ĐÃ TRIỂN KHAI",
};

/** Bảng đã normalize sẵn cả 2 phía — build 1 lần khi module load. */
const SECTION_BY_KEYWORD_NORMALIZED: Array<{ key: string; section: string }> = Object.entries(
  SECTION_BY_KEYWORD_RAW
).map(([k, v]) => ({ key: normalizeForMatch(k), section: v }));

function mapFieldToSection(field: string): string {
  const normalized = normalizeForMatch(field);
  for (const { key, section } of SECTION_BY_KEYWORD_NORMALIZED) {
    if (normalized.includes(key)) return section;
  }
  return "THÔNG TIN CHUNG";
}

/**
 * Node 5b: retry_crawl
 *
 * Tạo targeted section plan cho các field đang thiếu, rồi chạy crawl lại.
 * Missing fields là tên field cụ thể; cần map về section đúng để searchSectionGroup hoạt động.
 */
async function retryCrawlNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { missingFields, companyName, companyUrl, retryCount } = state;

  console.log(`\n🔁 [Retry Crawl #${retryCount + 1}] ──────────────────────────`);
  console.log(`  🔍 Target fields: ${missingFields.join(", ")}`);

  // Group missing fields by section (dùng mapFieldToSection đã fix ở trên)
  const grouped = new Map<string, string[]>();
  for (const f of missingFields) {
    const section = mapFieldToSection(f);
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section)!.push(f);
  }

  console.log(`  🗂️  Map field → section:`);
  for (const [section, fields] of grouped) {
    console.log(`     • ${section}: ${fields.join(", ")}`);
  }

  // Tạo 1 plan item per section
  const targetedPlan: SectionGroup = {
    groupName: `Retry #${retryCount + 1}: Missing Fields`,
    sections: Array.from(grouped.keys()),
    searchQueries: Array.from(grouped.entries()).map(([section, fields]) =>
      `${companyName} ${section} ${fields.join(" ")}`
    ),
  };

  console.log(`  🔎 Queries: ${targetedPlan.searchQueries.join(" | ")}`);

  const items = await searchSectionGroup(targetedPlan, companyName, companyUrl, "");

  console.log(`  📊 Tìm được ${items.length} items bổ sung`);

  // Merge vào researchData hiện có
  const researchData: Record<string, ResearchItem[]> = {
    ...state.researchData,
  };
  let newItemsCount = 0;
  for (const item of items) {
    if (!researchData[item.section]) {
      researchData[item.section] = [];
    }
    // Tránh trùng source
    const existingUrls = new Set(researchData[item.section].map((i) => i.source));
    if (!existingUrls.has(item.source)) {
      researchData[item.section].push(item);
      newItemsCount++;
    }
  }
  console.log(`  ✅ Thêm ${newItemsCount} items mới (${items.length - newItemsCount} trùng lặp)`);

  return {
    researchData,
    retryCount: retryCount + 1,
  };
}

/**
 * Node 6: propose_cooperation
 *
 * Viết đề xuất hợp tác CHỈ dựa trên VNF local data (getVNFContextText()).
 * TUYỆT ĐỐI không tìm internet.
 */
async function proposeCooperationNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { validatedFacts, companyName } = state;

  console.log("\n🤝 [Propose] ────────────────────────────────────────────");
  console.log(`  📥 Input: ${Object.keys(validatedFacts).length} sections, ${Object.values(validatedFacts).flat().length} facts`);

  const vnfContext = getVNFContextText();
  const companyFacts = formatValidatedFactsForProposal(validatedFacts);
  const promptText =
    `${PROPOSE_COOPERATION_PROMPT}\n\n` +
    `---\nTHÔNG TIN CÔNG TY: ${companyName}\n\n${companyFacts}\n\n` +
    `---\nDỮ LIỆU SẢN PHẨM VNF:\n\n${vnfContext}\n\n` +
    `---\nHãy viết đề xuất hợp tác cụ thể.`;

  console.log(`  📤 Gửi ${(promptText.length / 1024).toFixed(1)} KB prompt cho LLM viết đề xuất...`);
  const startTime = Date.now();

  const response = await callLLM(
    [new HumanMessage(promptText)],
    { toolChoice: "none", temperature: 0.4 }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  let proposal = String(response.content || "").trim();

  // Strip ```markdown ... ``` code blocks and any trailing explanation section
  const codeBlockMatch = proposal.match(/```(?:markdown)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    proposal = codeBlockMatch[1].trim();
  }
  // Remove trailing "Giải thích:" or "Explanation:" sections
  proposal = proposal.split(/\n##?\s*(?:Giải thích|Explanation|Lưu ý|Notes?):/i)[0].trim();

  console.log(`  📥 LLM trả lời sau ${elapsed}s: ${proposal.length} chars`);
  console.log(`     Preview: "${proposal.slice(0, 120)}${proposal.length > 120 ? "..." : ""}"`);
  console.log(`  ─────────────────────────────────────────────────────────`);

  return { cooperationProposal: proposal };
}

/** Format validated facts thành text để đưa vào prompt proposal */
function formatValidatedFactsForProposal(
  facts: Record<string, any[]>
): string {
  const parts: string[] = [];
  for (const [section, items] of Object.entries(facts)) {
    parts.push(`\n### ${section}`);
    for (const item of items) {
      const conf = item.confidence === "verified" ? "✓" : item.confidence === "partial" ? "~" : "✗";
      parts.push(`- ${conf} **${item.field}**: ${item.value}`);
    }
  }
  return parts.join("\n");
}

/**
 * Node 7: write_report
 *
 * Dùng hard-coded template renderer (utils/template.ts) để tạo báo cáo đúng format.
 * LLM chỉ viết intro + key facts + so_what, không viết Markdown tự do.
 */
async function writeReportNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  console.log("\n📝 [Write] ────────────────────────────────────────────");

  const { validatedFacts, cooperationProposal, companyName, outputLanguage, isNgo, researchData } = state;
  console.log(`  📥 Input: ${Object.keys(validatedFacts).length} sections, ${Object.values(validatedFacts).flat().length} facts, template=${isNgo ? "NGO" : "standard"}`);

  // Bước 1: LLM viết intro + key facts
  const factsSummary = Object.entries(validatedFacts)
    .map(([sec, facts]) => {
      const factLines = (facts as any[])
        .map((f) => `  - [${f.confidence}] ${f.field}: ${f.value}`)
        .join("\n");
      return `### ${sec}\n${factLines}`;
    })
    .join("\n\n");

  const introMsg = [
    `Dựa trên dữ liệu research về ${companyName}, hãy viết INTRO và KEY FACTS.`,
    ``,
    `YÊU CẦU QUAN TRỌNG:`,
    `- Chỉ trả về JSON thuần túy, KHÔNG thêm markdown, KHÔNG giải thích, KHÔNG code block.`,
    `- JSON phải có đúng 2 keys: "intro" (string) và "keyFacts" (array of strings).`,
    `- Giá trị phải là string/text, KHÔNG phải object hay nested JSON.`,
    ``,
    `1. INTRO: đoạn giới thiệu 3-5 dòng — ngành nghề, định vị thị trường, điểm nổi bật.`,
    `   Viết như executive summary. Ngôn ngữ: ${outputLanguage}.`,
    ``,
    `2. KEY FACTS: 4-5 bullet ✓ highlight — mỗi bullet 1 fact CỤ THỂ có con số.`,
    `   Ví dụ tốt: "✓ Top 1 pet snack tại Thái Lan với 30% thị phần (2024)"`,
    `   Ví dụ tệ: "✓ Công ty lớn trong ngành" (quá chung chung)`,
    ``,
    `DỮ LIỆU ĐÃ XÁC MINH:`,
    factsSummary,
    ``,
    `OUTPUT (JSON thuần):`,
    `{ "intro": "...", "keyFacts": ["✓ ...", "✓ ..."] }`,
  ].join("\n");

  console.log(`  ⏳ [1/2] LLM viết intro + key facts (${(introMsg.length / 1024).toFixed(1)} KB)...`);
  const t1 = Date.now();

  const introResp = await callLLM(
    [new HumanMessage(introMsg)],
    { toolChoice: "none", temperature: 0.4 }
  );
  console.log(`  ✅ Hoàn thành sau ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  let introText = `${companyName} là một công ty hoạt động trong lĩnh vực...`;
  let keyFacts: string[] = [];
  try {
    const raw = String(introResp.content || "").trim();
    // Ưu tiên lấy JSON từ code block nếu LLM vẫn wrap
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonCandidate.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      introText = typeof parsed.intro === "string" ? parsed.intro : introText;
      keyFacts = Array.isArray(parsed.keyFacts)
        ? parsed.keyFacts.map((f: any) => String(f))
        : [];
      console.log(`  📋 Intro: ${introText.length} chars, Key facts: ${keyFacts.length} bullets`);
    } else {
      console.warn("  ⚠️  Không tìm thấy JSON trong intro response.");
    }
  } catch {
    console.warn("  ⚠️  Không parse được intro JSON, dùng fallback.");
  }

  // Bước 2: LLM viết "so what" summary
  console.log(`  ⏳ [2/2] LLM viết "so what" strategic insights...`);
  const t2 = Date.now();

  const soWhatMsg = [
    `Dựa trên báo cáo research về ${companyName}, hãy viết 2-3 dòng "so what" cho VNF.`,
    ``,
    `VNF là nhà sản xuất nguyên liệu chức năng từ phụ phẩm tôm (Peptide tôm, Chitosan, Astaxanthin) tại Cà Mau, Việt Nam.`,
    ``,
    `"So what" cần trả lời: VNF nên làm gì với công ty này? Điểm nào nên khai thác ngay khi tiếp cận?`,
    ``,
    `Viết bằng tiếng Việt, súc tích, cụ thể, không chung chung.`,
  ].join("\n");

  const soWhatResp = await callLLM(
    [new HumanMessage(soWhatMsg)],
    { toolChoice: "none", temperature: 0.4 }
  );
  const soWhatSummary = String(soWhatResp.content || "")
    .trim()
    .replace(/^#+\s*["']?So what["']?\s*[\s\S]*?\n?/i, "")
    .replace(/^So what\s*(cho\s+VNF)?\s*[:\-]\s*/i, "")
    .trim();
  console.log(`  ✅ Hoàn thành sau ${((Date.now() - t2) / 1000).toFixed(1)}s: ${soWhatSummary.length} chars`);
  console.log(`     Preview: "${soWhatSummary.slice(0, 120)}${soWhatSummary.length > 120 ? "..." : ""}"`);

  // Build URL → title map from collected research data for nicer source refs
  const sourceTitles: Record<string, string> = {};
  for (const items of Object.values(researchData || {})) {
    for (const item of items) {
      if (item.title && item.source && !sourceTitles[item.source]) {
        sourceTitles[item.source] = item.title;
      }
    }
  }

  // Bước 3: Render báo cáo bằng hard-coded template
  console.log(`  🔧 Rendering template...`);
  const reportData: ReportData = {
    companyName,
    introText,
    keyFacts,
    sections: validatedFacts as Record<string, any[]>,
    cooperationProposal,
    isNgo: isNgo || false,
    soWhatSummary,
    sourceTitles,
  };

  const finalReport = renderReport(reportData);

  console.log(`  ✅ Báo cáo render xong: ${finalReport.length} chars (${(finalReport.length / 1024).toFixed(1)} KB)`);
  console.log(`  📋 ${Object.keys(validatedFacts).length} sections, ${Object.values(validatedFacts).flat().length} facts, template=${isNgo ? "NGO" : "standard"}`);
  console.log(`  ─────────────────────────────────────────────────────────`);

  return { finalReport, soWhatSummary };
}

/**
 * Node 8: output
 *
 * Lưu file, in kết quả, trả về summary.
 */
async function outputNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  console.log("\n📄 [Output] Lưu báo cáo...");

  const { finalReport, companyName, missingFields, soWhatSummary } = state;

  // Tạo tên file: Company_Research_<TÊN_VIẾT_TẮT>.md
  const shortName = companyName
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\s]/g, "")
    .split(/\s+/)
    .slice(0, 3)
    .join("_");
  const fileName = `Company_Research_${shortName}.md`;

  // Lưu file
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const outputDir = process.cwd();
  const filePath = path.default.join(outputDir, fileName);

  await fs.default.writeFile(filePath, finalReport, "utf-8");

  console.log(`  📁 File đã lưu: ${filePath}`);
  console.log(`  📏 Kích thước: ${(finalReport.length / 1024).toFixed(1)} KB`);

  if (missingFields.length > 0) {
    console.log(`\n⚠️  Các field _Chưa xác minh_ (${missingFields.length}):`);
    for (const f of missingFields) {
      console.log(`     • ${f}`);
    }
  }

  if (soWhatSummary) {
    console.log(`\n💡 SO WHAT cho VNF:\n   ${soWhatSummary}`);
  }

  return { reportFilePath: filePath };
}

// ─── Build Graph ─────────────────────────────────────────────────────────────

/**
 * Xây dựng StateGraph cho VNF Company Research:
 *
 *   START → ask_user → plan_sections → crawl → cross_validate
 *   → check_missing ──[missing & retry<maxRetries]→ retry_crawl → cross_validate
 *                   ──[ok]──────────────────────→ propose_cooperation → write_report → output → END
 */
const workflow = new StateGraph(AgentState)
  // ── Nodes ────────────────────────────────────────────────────────────────
  .addNode("ask_user", askUserNode)
  .addNode("plan_sections", planSectionsNode)
  .addNode("crawl", crawlNode)
  .addNode("cross_validate", crossValidateNode)
  .addNode("retry_crawl", retryCrawlNode)
  .addNode("propose_cooperation", proposeCooperationNode)
  .addNode("write_report", writeReportNode)
  .addNode("output", outputNode)

  // ── Edges ────────────────────────────────────────────────────────────────
  .addEdge(START, "ask_user")
  .addEdge("ask_user", "plan_sections")
  .addEdge("plan_sections", "crawl")
  .addEdge("crawl", "cross_validate")

  // Conditional: check_missing → retry hoặc proceed
  .addConditionalEdges("cross_validate", checkMissingRouter, {
    retry_crawl: "retry_crawl",
    propose: "propose_cooperation",
  })

  .addEdge("retry_crawl", "cross_validate") // Sau retry → validate lại
  .addEdge("propose_cooperation", "write_report")
  .addEdge("write_report", "output")
  .addEdge("output", END);

/**
 * Compiled graph — sẵn sàng để invoke
 */
export const agentGraph = workflow.compile();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Chạy VNF Company Research cho 1 công ty.
 *
 * @param companyName - Tên công ty cần research
 * @param companyUrl - Website URL (optional, null nếu không có)
 * @param outputLanguage - Ngôn ngữ output ("vi" | "en" | "bilingual")
 * @param vnfInterestReason - Lý do VNF quan tâm
 * @param maxRetries - Số lần retry tối đa cho missing fields (mặc định DEFAULT_MAX_RETRIES)
 * @returns Final state chứa báo cáo và metadata
 */
export async function runResearch(params: {
  companyName: string;
  companyUrl?: string | null;
  outputLanguage?: "vi" | "en" | "bilingual";
  vnfInterestReason?: string;
  maxRetries?: number;
}): Promise<AgentStateType> {
  const {
    companyName,
    companyUrl = null,
    outputLanguage = "vi",
    vnfInterestReason = "",
    maxRetries = DEFAULT_MAX_RETRIES,
  } = params;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     🏢 VNF Company Research Agent — LangGraph            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n📋 Công ty: ${companyName}`);
  if (companyUrl) console.log(`🔗 Website: ${companyUrl}`);
  console.log(`🌐 Ngôn ngữ: ${outputLanguage}`);
  console.log(`🎯 Lý do VNF quan tâm: ${vnfInterestReason || "(chưa cung cấp)"}`);
  console.log(`🤖 Model: ${MODEL}`);
  console.log("═".repeat(60));

  const initialState: Partial<AgentStateType> = {
    messages: [
      new HumanMessage(
        `Research công ty: ${companyName}${companyUrl ? ` - Website: ${companyUrl}` : ""}`
      ),
    ],
    companyName,
    companyUrl,
    outputLanguage,
    vnfInterestReason,
    retryCount: 0,
    maxRetries,
  };

  const result = await agentGraph.invoke(initialState);

  console.log("═".repeat(60));
  console.log("✅ Research hoàn thành!\n");

  return result;
}