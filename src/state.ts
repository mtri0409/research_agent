import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Một mục dữ liệu đã thu thập từ 1 nguồn */
export interface ResearchItem {
  /** URL nguồn */
  source: string;
  /** Tiêu đề nguồn */
  title?: string;
  /** Nội dung thô trích xuất được */
  content: string;
  /** Section mà dữ liệu này thuộc về */
  section: string;
}

/** Một fact đã được LLM xác minh */
export interface ValidatedFact {
  /** Tên field (vd: "Tên pháp lý", "Ngày đăng ký") */
  field: string;
  /** Giá trị đã xác minh */
  value: string;
  /** Danh sách nguồn xác nhận fact này */
  sources: string[];
  /** Độ tin cậy: verified | partial | unverified */
  confidence: "verified" | "partial" | "unverified";
  /** Ghi chú nếu có mâu thuẫn giữa các nguồn */
  note?: string;
}

/** Kế hoạch research cho một nhóm section */
export interface SectionGroup {
  /** Tên nhóm (vd: "A: Tổng quan") */
  groupName: string;
  /** Các section trong nhóm */
  sections: string[];
  /** Từ khóa tìm kiếm gợi ý */
  searchQueries: string[];
}

/** Ngôn ngữ output */
export type OutputLanguage = "vi" | "en" | "bilingual";

// ─── State ──────────────────────────────────────────────────────────────────

/**
 * VNF Company Research Agent State.
 *
 * State xuyên suốt toàn bộ pipeline từ lúc nhận input đến khi xuất báo cáo.
 */
export const AgentState = Annotation.Root({
  // ── Conversation ────────────────────────────────────────────────────────

  /** Lịch sử hội thoại (dùng cho LLM context + LangGraph compatibility) */
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => {
      if (Array.isArray(current)) {
        return [...current, ...(Array.isArray(update) ? update : [update])];
      }
      return Array.isArray(update) ? update : [update];
    },
    default: () => [],
  }),

  // ── User Input ──────────────────────────────────────────────────────────

  /** Tên công ty người dùng muốn research */
  companyName: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  /** Website URL nếu người dùng cung cấp (null nếu chỉ có tên) */
  companyUrl: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),

  /** Ngôn ngữ output (hỏi user qua interrupt nếu chưa có) */
  outputLanguage: Annotation<OutputLanguage>({
    reducer: (_, update) => update,
    default: () => "vi",
  }),

  /** Lý do VNF quan tâm đến công ty này */
  vnfInterestReason: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  // ── Research Planning ───────────────────────────────────────────────────

  /** Kế hoạch chia section thành các group để search song song */
  sectionPlan: Annotation<SectionGroup[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // ── Research Data ───────────────────────────────────────────────────────

  /** Dữ liệu thô thu thập được, keyed by section name */
  researchData: Annotation<Record<string, ResearchItem[]>>({
    reducer: (current, update) => {
      // Merge: nếu cùng section → nối thêm items, tránh trùng source
      const merged: Record<string, ResearchItem[]> = { ...(current || {}) };
      for (const [section, items] of Object.entries(update || {})) {
        const existing = merged[section] || [];
        const existingUrls = new Set(existing.map((i) => i.source));
        const newItems = items.filter((i) => !existingUrls.has(i.source));
        merged[section] = [...existing, ...newItems];
      }
      return merged;
    },
    default: () => ({}),
  }),

  // ── Validation ──────────────────────────────────────────────────────────

  /** Facts đã được LLM đối chiếu và xác minh */
  validatedFacts: Annotation<Record<string, ValidatedFact[]>>({
    reducer: (_, update) => update,
    default: () => ({}),
  }),

  /** Danh sách field còn thiếu dữ liệu (cần research lại) */
  missingFields: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // ── Loop Control ────────────────────────────────────────────────────────

  /** Số lần đã retry cho missing fields */
  retryCount: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),

  /** Số lần retry tối đa (mặc định 3) */
  maxRetries: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 3,
  }),

  // ── Output ──────────────────────────────────────────────────────────────

  /** Nội dung đề xuất hợp tác (chỉ dựa trên VNF local data) */
  cooperationProposal: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  /** Nội dung "so what" — 2-3 dòng nhận xét chiến lược cho VNF */
  soWhatSummary: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  /** True nếu công ty là NGO / tổ chức phi lợi nhuận → dùng template khác */
  isNgo: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),

  /** Báo cáo Markdown hoàn chỉnh */
  finalReport: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  /** Đường dẫn file báo cáo đã lưu */
  reportFilePath: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),
});

/** Type của state để dùng trong các node function */
export type AgentStateType = typeof AgentState.State;
