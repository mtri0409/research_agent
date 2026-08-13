# VNF Company Research Agent

Agent tự động nghiên cứu thông tin công ty đối tác/tiềm năng của VNF. Người dùng nhập một câu tự nhiên (tên công ty, URL, ngôn ngữ, lý do quan tâm), agent tự động tìm website, thu thập dữ liệu đa nguồn, đối chiếu, đánh giá độ tin cậy và xuất báo cáo Markdown chuẩn hóa.

## Cấu trúc thư mục

```
src/
├── index.ts           # Entry point: parse input, discover URL, multi-turn REPL
├── graph.ts           # LangGraph pipeline + nodes + crawl logic
├── state.ts           # AgentState và type definitions
├── prompts.ts         # Prompts cho từng node (plan, extract, validate, propose)
├── tools/
│   ├── research.ts    # Tavily search + fetch URL + HTML parse
│   └── vnf.ts         # VNF product context (Peptide tôm, Chitosan, Astaxanthin)
└── utils/
    └── template.ts    # Render báo cáo Markdown + source registry
```

## Cách chạy

1. Cài đặt:
   ```bash
   pnpm install
   ```
2. Tạo file `.env`:
   ```env
   AI_API_URL=https://api.openai.com/v1
   AI_API_KEY=sk-...
   MODEL=gpt-4o-mini
   TAVILY_API_KEY=tvly-...
   ```
3. Chạy:
   ```bash
   pnpm dev
   ```

Ví dụ input:
```text
VNG, tiếng Anh, đối thủ cạnh tranh
```

Agent sẽ parse input, tìm URL (nếu thiếu), chạy LangGraph pipeline, lưu và hiển thị báo cáo Markdown, sau đó chờ công ty tiếp theo.

## Công nghệ sử dụng

- TypeScript 5.x, Node.js ESM
- LangGraph + LangChain Core (orchestration)
- OpenAI SDK (OpenAI-compatible endpoint qua `AI_API_URL`/`AI_API_KEY`/`MODEL`)
- Tavily Core (web search)
- Cheerio + native `fetch` (crawl/parse HTML)
- Zod (schema validation)
- dotenv
- docx, exceljs, adm-zip, js-yaml, jszip (xuất Office dự phòng)

## Các điểm cần lưu ý

- Pipeline: `plan_sections` → `crawl` (3 rounds, song song) → `cross_validate` → `check_missing` → `propose_cooperation` → `write_report`.
- Mỗi section group được research độc lập với `asyncPool` concurrency.
- Website chính thức được pre-fetch làm **primary source**, bổ sung Tavily search và fetch URL bên ngoài.
- Confidence: `verified` (≥2 nguồn độc lập), `partial` (1 nguồn), `unverified` (không có dữ liệu).
- Phát hiện NGO/tổ chức phi lợi nhuận để chuyển sang template riêng.
- `TAVILY_API_KEY` thiếu thì Tavily vẫn chạy keyless nhưng giới hạn rất thấp.
- `tsconfig.json` có include dư thừa `src/skill/...` (2 file không tồn tại); `src/**/*` đã đủ.
- TypeScript `^7.0.2` trong `package.json` là pre-release; nếu lỗi type resolution, cân nhắc hạ xuống `^5.5`.
- Các field `_Chưa xác minh_` cần verify thủ công trước khi dùng cho quyết định kinh doanh.
