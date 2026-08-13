/**
 * VNF Company Research — Report Template Renderer
 *
 * Render báo cáo Markdown đúng format references/template.md.
 * LLM chỉ cung cấp content; code này đảm bảo:
 * - Bảng 2 cột với <br> và &nbsp;&nbsp; đúng chuẩn
 * - Footnote [1], [2]... tự động, NHẤT QUÁN trên toàn bộ report (dùng 1 sourceMap dùng chung)
 * - Nguồn tham khảo hiển thị [Tên nguồn] — URL, không bị trùng khi 1 URL xuất hiện ở nhiều section
 */

import type { ValidatedFact } from "../state.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReportData {
  companyName: string;
  introText: string; // Đoạn giới thiệu 3-5 dòng
  keyFacts: string[]; // 3-5 bullet ✓
  sections: Record<string, ValidatedFact[]>; // Facts theo section
  cooperationProposal: string; // Đề xuất hợp tác
  isNgo: boolean; // True nếu là NGO/quỹ
  soWhatSummary: string; // 2-3 dòng "so what" cho VNF
  sourceTitles?: Record<string, string>; // URL → tên nguồn (nếu có)
}

/** Registry dùng chung xuyên suốt cả report — TRÁNH trùng số thứ tự nguồn giữa các section */
interface SourceRegistry {
  globalSources: string[];
  map: Map<string, number>;
}

function createSourceRegistry(): SourceRegistry {
  return { globalSources: [], map: new Map() };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Escape ký tự phá vỡ Markdown table */
function esc(val: string): string {
  return val
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
    .replace(/\r/g, "");
}

/** Bỏ bullet markers đầu dòng */
function stripBullet(val: string): string {
  return val.replace(/^[\s]*[•\-\*✓✔][\s]+/, "").trim();
}

/** Làm sạch value, giữ lại các sub-bullet dạng ○ */
function cleanValue(val: string): string {
  return stripBullet(val)
    .replace(/\n\s*[-•]\s*/g, "<br>&nbsp;&nbsp;• ")
    .replace(/\n\s*○\s*/g, "<br>&nbsp;&nbsp;○ ");
}

// ─── Source Management (FIX: dùng registry dùng chung, không tạo Map mới mỗi lần) ──

/**
 * Đăng ký nguồn của các fact vào registry DÙNG CHUNG.
 * Nếu URL đã tồn tại (dù được đăng ký từ section khác) → tái sử dụng index cũ,
 * KHÔNG push trùng vào globalSources.
 */
function registerSources(facts: ValidatedFact[], registry: SourceRegistry): void {
  for (const f of facts) {
    for (const src of f.sources) {
      if (!registry.map.has(src)) {
        registry.map.set(src, registry.globalSources.length + 1);
        registry.globalSources.push(src);
      }
    }
  }
}

function footnotes(fact: ValidatedFact, registry: SourceRegistry): string {
  const indexes = fact.sources
    .map((s) => registry.map.get(s))
    .filter((n): n is number => !!n);
  return indexes.length ? ` [${indexes.join(", ")}]` : "";
}

function formatSources(registry: SourceRegistry, sourceTitles: Record<string, string> = {}): string {
  if (!registry.globalSources.length) return "_Không có nguồn_";
  return registry.globalSources
    .map((s, i) => {
      const title = sourceTitles[s] || "";
      return title ? `[${i + 1}] ${esc(title)} — ${s}` : `[${i + 1}] ${s}`;
    })
    .join("<br>");
}

// ─── Leadership role normalization (FIX: nhận diện vai trò bằng regex thay vì split thô) ──

/**
 * Danh sách vai trò lãnh đạo đã biết, dùng để gom nhóm field về ĐÚNG 1 block/người,
 * bất kể LLM viết field là "CEO / Tổng giám đốc" hay chỉ "CEO" hay "Tổng giám đốc: ...".
 * Thứ tự quan trọng: role dài/cụ thể hơn nên đứng trước để match đúng trước.
 */
const LEADERSHIP_ROLES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /CEO|Tổng\s*giám\s*đốc(?!\s*Tài|\s*Vận|\s*Công)/i, canonical: "CEO / Tổng Giám Đốc" },
  { pattern: /CFO|Giám\s*đốc\s*Tài\s*chính/i, canonical: "CFO / Giám Đốc Tài Chính" },
  { pattern: /COO|Giám\s*đốc\s*Vận\s*hành/i, canonical: "COO / Giám Đốc Vận Hành" },
  { pattern: /CTO|Giám\s*đốc\s*Công\s*nghệ/i, canonical: "CTO / Giám Đốc Công Nghệ" },
  { pattern: /Chủ\s*tịch/i, canonical: "Chủ Tịch HĐQT" },
];

/** Trích xuất key nhóm chuẩn hoá từ field label, tránh tách 1 người thành nhiều block. */
function canonicalLeaderKey(field: string): string {
  for (const { pattern, canonical } of LEADERSHIP_ROLES) {
    if (pattern.test(field)) return canonical;
  }
  // Fallback: có thể là tên riêng (vd đã gán field = họ tên) hoặc vai trò khác chưa biết
  const fallback = field.split(/[-–:]/)[0].trim();
  return fallback || "Ban lãnh đạo khác";
}

// ─── Section Formatters ────────────────────────────────────────────────────

function formatGeneric(facts: ValidatedFact[], registry: SourceRegistry): string {
  if (!facts.length) return "_Chưa xác minh_";
  registerSources(facts, registry);
  return facts
    .map((f) => {
      const label = f.field && !f.value.toLowerCase().startsWith(f.field.toLowerCase())
        ? `**${esc(f.field)}:** `
        : "";
      const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
      return `• ${label}${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`;
    })
    .join("<br>");
}

function formatCompanyInfo(facts: ValidatedFact[], registry: SourceRegistry): string {
  if (!facts.length) return "_Chưa xác minh_";

  const orderedLabels = [
    "Tên pháp lý",
    "Tên tiếng Anh",
    "Ngày đăng ký",
    "Năm thành lập",
    "Trụ sở chính",
    "Website",
    "LinkedIn",
    "Facebook",
    "Email",
    "Hotline",
    "Vốn đăng ký",
    "Cơ cấu sở hữu",
    "Quy mô thị trường",
    "Nhân sự",
    "Mã số thuế",
  ];

  registerSources(facts, registry);

  const matched = new Set<number>();
  const lines: string[] = [];

  for (const label of orderedLabels) {
    const idx = facts.findIndex(
      (f, i) =>
        !matched.has(i) &&
        f.field &&
        f.field.toLowerCase().includes(label.toLowerCase())
    );
    if (idx >= 0) {
      matched.add(idx);
      const f = facts[idx];
      const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
      lines.push(`• **${esc(label)}:** ${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`);
    }
  }

  // Append remaining facts
  for (let i = 0; i < facts.length; i++) {
    if (matched.has(i)) continue;
    const f = facts[i];
    const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
    const label = f.field ? `**${esc(f.field)}:** ` : "";
    lines.push(`• ${label}${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`);
  }

  return lines.length ? lines.join("<br>") : "_Chưa xác minh_";
}

function formatLeadership(facts: ValidatedFact[], registry: SourceRegistry): string {
  if (!facts.length) return "_Chưa xác minh_";
  registerSources(facts, registry);

  // Group facts theo vai trò CHUẨN HOÁ (fix: tránh "CEO / Tổng giám đốc" và "CEO" tách 2 block)
  const groups = new Map<string, ValidatedFact[]>();
  const groupOrder: string[] = [];
  for (const f of facts) {
    const key = canonicalLeaderKey(f.field || "Khác");
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(f);
  }

  const blocks: string[] = [];
  for (const name of groupOrder) {
    const items = groups.get(name)!;
    const detail = items
      .map((f) => {
        const rawField = f.field || "";
        const rest = rawField.includes(":") ? rawField.split(":").slice(1).join(":").trim() : "";
        const label = rest && !f.value.toLowerCase().startsWith(rest.toLowerCase())
          ? `**${esc(rest)}:** `
          : "";
        const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
        return `&nbsp;&nbsp;• ${label}${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`;
      })
      .join("<br>");
    blocks.push(`**${esc(name)}**<br>${detail}`);
  }

  return blocks.join("<br><br>");
}

function formatProjects(facts: ValidatedFact[], registry: SourceRegistry): string {
  if (!facts.length) return "_Chưa xác minh_";
  registerSources(facts, registry);
  return facts
    .map((f) => {
      const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
      const title = f.field ? `**${esc(f.field)}:** ` : "";
      return `• ${title}${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`;
    })
    .join("<br><br>");
}

function formatProducts(facts: ValidatedFact[], registry: SourceRegistry): string {
  if (!facts.length) return "_Chưa xác minh_";
  registerSources(facts, registry);

  const brands = new Map<string, ValidatedFact[]>();
  const brandOrder: string[] = [];
  for (const f of facts) {
    const key = (f.field || "Khác").split(/[-–:]/)[0].trim();
    if (!brands.has(key)) {
      brands.set(key, []);
      brandOrder.push(key);
    }
    brands.get(key)!.push(f);
  }

  const blocks: string[] = [];
  for (const brand of brandOrder) {
    const items = brands.get(brand)!;
    const lines = items
      .map((f) => {
        const rest = (f.field || "").split(":").slice(1).join(":").trim();
        const label = rest ? `**${esc(rest)}:** ` : "";
        const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
        return `• ${label}${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)}`;
      })
      .join("<br>");
    blocks.push(`**${esc(brand)}**<br>${lines}`);
  }

  return blocks.join("<br><br>");
}

function formatAppendix(productFacts: ValidatedFact[], registry: SourceRegistry): string {
  if (!productFacts.length) return "";
  registerSources(productFacts, registry);

  const lines = productFacts
    .map((f) => {
      const brand = (f.field || "Sản phẩm").split(/[-–:]/)[0].trim();
      const sku = (f.field || "").split(":")[1]?.trim() || f.field || "Sản phẩm";
      const conf = f.confidence === "unverified" ? " ⚠️" : f.confidence === "partial" ? " (1 nguồn)" : "";
      return `| **${esc(sku)}** | • **Thương hiệu:** ${esc(brand)}<br>• **Thông tin:** ${esc(cleanValue(f.value))}${conf}${footnotes(f, registry)} |`;
    })
    .join("\n");

  return `## B. APPENDIX — Chi tiết danh mục sản phẩm

| PHÂN LOẠI | THÔNG TIN SẢN PHẨM |
|---|---|
${lines}
`;
}

function formatCooperation(text: string): string {
  if (!text.trim()) return "_Chưa có đề xuất_";
  return esc(text);
}

// ─── Main Render ────────────────────────────────────────────────────────────

/**
 * Render báo cáo VNF Company Research hoàn chỉnh theo template.
 * Output là Markdown string.
 */
export function renderReport(data: ReportData): string {
  // FIX: 1 registry DÙNG CHUNG cho toàn bộ report — đảm bảo mỗi URL chỉ có 1 số thứ tự,
  // dù xuất hiện ở nhiều section khác nhau.
  const registry = createSourceRegistry();
  const sections = data.sections;
  const sourceTitles = data.sourceTitles || {};

  // ── Phần mở đầu ────────────────────────────────────────────────────────
  const intro = (data.introText || `Báo cáo research về ${data.companyName}.`).trim();
  const keyFacts = data.keyFacts.length > 0
    ? data.keyFacts
        .map((f) => {
          const clean = stripBullet(f);
          return clean ? `✓ ${esc(clean)}` : "";
        })
        .filter(Boolean)
        .join("\n")
    : "✓ _Đang cập nhật_";

  // ── A. THÔNG TIN TỔNG QUAN ─────────────────────────────────────────────
  const sectionOrder = data.isNgo
    ? [
        "THÔNG TIN CHUNG",
        "LÃNH ĐẠO",
        "HOẠT ĐỘNG KINH DOANH",
        "CÁC DỰ ÁN ĐÃ TRIỂN KHAI",
        "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG",
        "BỀN VỮNG VÀ MÔI TRƯỜNG",
        "HIGHLIGHT CÔNG TY",
        "ĐỀ XUẤT HỢP TÁC",
      ]
    : [
        "THÔNG TIN CHUNG",
        "LÃNH ĐẠO",
        "HOẠT ĐỘNG KINH DOANH",
        "NHÀ MÁY",
        "DANH MỤC SẢN PHẨM",
        "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG",
        "BỀN VỮNG VÀ MÔI TRƯỜNG",
        "CHUỖI GIÁ TRỊ",
        "HIGHLIGHT CÔNG TY",
        "ĐỀ XUẤT HỢP TÁC",
      ];

  const tableRows: string[] = [];
  for (const sectionName of sectionOrder) {
    const facts = sections[sectionName] || [];

    let cellContent: string;
    switch (sectionName) {
      case "THÔNG TIN CHUNG":
        cellContent = formatCompanyInfo(facts, registry);
        break;
      case "LÃNH ĐẠO":
        cellContent = formatLeadership(facts, registry);
        break;
      case "DANH MỤC SẢN PHẨM":
        cellContent = formatProducts(facts, registry);
        break;
      case "CÁC DỰ ÁN ĐÃ TRIỂN KHAI":
        cellContent = formatProjects(facts, registry);
        break;
      case "ĐỀ XUẤT HỢP TÁC":
        cellContent = formatCooperation(data.cooperationProposal);
        break;
      default:
        cellContent = formatGeneric(facts, registry);
    }

    tableRows.push(`| **${sectionName}** | ${cellContent} |`);
  }

  // ── B. APPENDIX (nếu danh mục sản phẩm phong phú) ─────────────────────────
  const productFacts = sections["DANH MỤC SẢN PHẨM"] || [];
  const appendixText = productFacts.length >= 4
    ? formatAppendix(productFacts, registry)
    : "";

  // ── Nguồn tham khảo ────────────────────────────────────────────────────
  const sourcesText = formatSources(registry, sourceTitles);

  // ── So What ─────────────────────────────────────────────────────────────
  const soWhat = (data.soWhatSummary || "").trim();

  // ── Assemble ────────────────────────────────────────────────────────────
  return `# Company Research — ${data.companyName}

> **VNF Company Research** · ${new Date().toLocaleDateString("vi-VN")}

---

${intro}

${keyFacts}

---

## A. THÔNG TIN TỔNG QUAN

| | |
|---|---|
${tableRows.join("\n")}

---

${appendixText ? `${appendixText}\n---\n\n` : ""}## Nguồn tham khảo

${sourcesText}

---

## 💡 "So What" cho VNF

${soWhat || "_Chưa có nhận xét chiến lược._"}

---

*Báo cáo được tạo tự động bởi VNF Company Research Agent. Các trường _Chưa xác minh_ cần được verify thủ công trước khi sử dụng cho quyết định kinh doanh.*
`;
}