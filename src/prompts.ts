/**
 * System prompts cho từng node trong VNF Company Research Graph.
 *
 * Mỗi prompt được thiết kế cho 1 nhiệm vụ cụ thể trong pipeline.
 */

// ─── Node: plan_sections ────────────────────────────────────────────────────

/**
 * Prompt cho node lập kế hoạch research.
 * LLM nhận tên công ty + URL (nếu có) và chia các section cần research
 * thành 3-4 nhóm để search song song.
 */
export const PLAN_SECTIONS_PROMPT = `Bạn là research planner cho VNF Company Research.

NHIỆM VỤ:
Dựa trên tên công ty, website URL, lý do VNF quan tâm và ngành nghề, hãy chia các section cần research thành
3-4 nhóm để tìm kiếm song song. Xác định luôn công ty có phải NGO / tổ chức phi lợi nhuận / viện nghiên cứu / quỹ / trường học không.

CÁC SECTION CẦN COVER (từ VNF template):
1. THÔNG TIN CHUNG: Tên pháp lý, ngày đăng ký, trụ sở, website, mạng xã hội, hotline/email, vốn đăng ký, cơ cấu sở hữu, quy mô, nhân sự
2. LÃNH ĐẠO: Họ tên, chức danh, background, LinkedIn
3. HOẠT ĐỘNG KINH DOANH: Lĩnh vực, thương hiệu, thị trường, tiêu chuẩn chất lượng
4. NHÀ MÁY: Địa chỉ, công suất, công nghệ, chứng nhận (chỉ cho công ty sản xuất)
5. DANH MỤC SẢN PHẨM: Phân theo thương hiệu, dòng sản phẩm (chỉ cho công ty sản xuất)
6. KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG: Phân khúc, kênh phân phối, đối tác
7. BỀN VỮNG VÀ MÔI TRƯỜNG: Chứng nhận, CSR, mục tiêu phát thải
8. CHUỖI GIÁ TRỊ: Đầu vào, chế biến, đầu ra, phân phối (chỉ cho công ty sản xuất)
9. HIGHLIGHT CÔNG TY: Thành tựu, giải thưởng, lợi thế cạnh tranh
10. CÁC DỰ ÁN ĐÃ TRIỂN KHAI (thay thế NHÀ MÁY + DANH MỤC SẢN PHẨM nếu là NGO / viện / quỹ / trường)

NGO / INSTITUTE RULE:
Nếu công ty là NGO, viện nghiên cứu, quỹ, tổ chức phi lợi nhuận, hoặc lý do VNF quan tâm là "Tổ chức phi lợi nhuận / NGO":
- KHÔNG research NHÀ MÁY, DANH MỤC SẢN PHẨM, CHUỖI GIÁ TRỊ sản xuất.
- THAY bằng CÁC DỰ ÁN ĐÃ TRIỂN KHAI.
- Đặt isNgo = true.

OUTPUT FORMAT (JSON):
{
  "isNgo": true/false,
  "groups": [
    {
      "groupName": "A: Tổng quan & Lãnh đạo",
      "sections": ["THÔNG TIN CHUNG", "LÃNH ĐẠO"],
      "searchQueries": ["<tên công ty> company overview founded", "<tên công ty> leadership team CEO"]
    }
  ]
}

QUY TẮC:
- Search queries phải bằng tiếng Anh hoặc tiếng địa phương phù hợp để có kết quả toàn cầu tốt nhất.
- Nếu có URL công ty → thêm query fetch website chính.
- Mỗi group có 3-6 search queries, nhắm vào các section cụ thể.
- Chỉ trả về JSON thuần, không thêm text gì khác.`;

// ─── Node: search_section ────────────────────────────────────────────────────

/**
 * CHECKLIST chi tiết từng field cần tìm cho mỗi section trong VNF template.
 * Dùng trong Round 2 (deep extraction) để LLM biết chính xác cần tìm gì.
 *
 * QUY TẮC ĐẶT TÊN FIELD (quan trọng — ảnh hưởng trực tiếp đến cách template.ts gom nhóm):
 * Mỗi dòng con của 1 vai trò/thực thể PHẢI dùng ĐÚNG 1 nhãn đầy đủ, nhất quán
 * (vd luôn "CEO / Tổng giám đốc:", không được rút gọn thành "CEO:" ở dòng sau).
 * Nếu nhãn không nhất quán, LLM sẽ tạo ra các field name khác nhau cho cùng 1 người/thực thể,
 * khiến report bị tách thành nhiều block trùng lặp.
 */
export const FIELD_CHECKLIST: Record<string, string> = {
  "THÔNG TIN CHUNG": `
☐ Tên pháp lý đầy đủ (theo đăng ký kinh doanh, có dấu tiếng Việt nếu có)
☐ Tên tiếng Anh / tên giao dịch quốc tế
☐ Ngày đăng ký / năm thành lập (DD/MM/YYYY hoặc năm)
☐ Trụ sở chính (địa chỉ đầy đủ: số nhà, đường, phường/xã, quận/huyện, tỉnh/TP, quốc gia)
☐ Website chính thức
☐ LinkedIn URL (tìm trên Google: "tên công ty LinkedIn")
☐ Facebook / Twitter / mạng xã hội khác (nếu có)
☐ Email công khai (thường ở Contact page hoặc footer)
☐ Hotline / Số điện thoại (thường ở Contact page hoặc footer)
☐ Vốn đăng ký (số tiền cụ thể + đơn vị tiền tệ, nguồn: đăng ký kinh doanh hoặc báo chí)
☐ Cơ cấu sở hữu (cổ đông sáng lập, cổ đông lớn, % sở hữu nếu có)
☐ Quy mô nhân sự (số lượng cụ thể hoặc khoảng ước tính, kèm năm)
☐ Quy mô thị trường / vị trí ngành (vd: "Top 3 fintech Việt Nam", "chiếm 15% thị phần...")
☐ Mã số thuế / Mã số doanh nghiệp (nếu tìm được)`,

  // FIX: mỗi dòng của CÙNG 1 vai trò dùng CHUNG 1 nhãn đầy đủ, không rút gọn giữa chừng.
  "LÃNH ĐẠO": `
☐ CEO / Tổng giám đốc: Họ tên đầy đủ, năm sinh (nếu có), trình độ học vấn
☐ CEO / Tổng giám đốc: Kinh nghiệm trước đây (công ty cũ, vị trí)
☐ CEO / Tổng giám đốc: LinkedIn URL
☐ CFO / Giám đốc Tài chính: Họ tên, background
☐ COO / Giám đốc Vận hành: Họ tên, background (nếu có)
☐ CTO / Giám đốc Công nghệ: Họ tên, background (nếu là công ty tech)
☐ Chủ tịch HĐQT: Họ tên, background (nếu khác CEO)
☐ Ban lãnh đạo khác: thành viên HĐQT, Ban kiểm soát (nếu tìm được)

QUY TẮC ĐẶT TÊN FIELD (bắt buộc):
- Dùng ĐÚNG 1 nhãn đầy đủ cho mỗi vai trò trong TẤT CẢ field liên quan đến người đó
  (vd luôn "CEO / Tổng giám đốc: <nội dung>", không viết tắt thành "CEO: <nội dung>" ở field khác).
- Mỗi người: mô tả 1-2 dòng trách nhiệm chính hiện tại.`,

  "HOẠT ĐỘNG KINH DOANH": `
☐ Lĩnh vực kinh doanh chính (mô tả cụ thể, không chung chung)
☐ Sản phẩm / dịch vụ cốt lõi (liệt kê tên cụ thể)
☐ Thương hiệu chính (tên thương hiệu, phân khúc, đối tượng khách hàng)
☐ Thị trường nội địa: phân phối qua kênh nào? (siêu thị, online, đại lý...)
☐ Thị trường quốc tế: xuất khẩu đến bao nhiêu quốc gia? Tên các thị trường chính?
☐ Tiêu chuẩn chất lượng: GMP, HACCP, ISO 9001, ISO 14001, BRC, IFS, ASC, MSC, FDA... (liệt kê cụ thể từng chứng nhận + năm đạt được nếu có)
☐ Doanh thu (số liệu cụ thể + năm, nguồn: báo cáo tài chính hoặc báo chí)
☐ Tốc độ tăng trưởng (CAGR nếu có)`,

  "NHÀ MÁY": `
☐ Số lượng nhà máy / cơ sở sản xuất
☐ Địa chỉ từng nhà máy (địa chỉ đầy đủ)
☐ Vai trò từng nhà máy (sản xuất gì? lắp ráp? R&D? kho vận?)
☐ Công suất từng nhà máy (tấn/năm, units/giờ, hoặc m2 sàn...)
☐ Công nghệ sản xuất đặc trưng (dây chuyền, tự động hóa, robot...)
☐ Chứng nhận nhà máy (ISO, GMP, HACCP, BRC...)
☐ Quy trình sản xuất chính (các công đoạn: nguyên liệu → chế biến → đóng gói → kho)
☐ Diện tích / quy mô nhà máy (m2 hoặc ha)`,

  "DANH MỤC SẢN PHẨM": `
☐ Số lượng SKU / dòng sản phẩm
☐ Phân theo thương hiệu (liệt kê từng thương hiệu)
☐ Phân theo dòng sản phẩm (tên dòng, mô tả, thành phần chính, công dụng)
☐ Phân theo loài (cho pet food: chó, mèo, cá...)
☐ Sản phẩm flagship / best-seller (tên + điểm nổi bật)
☐ Dịch vụ OEM/ODM (nếu có): năng lực, đối tác tiêu biểu
☐ Bao bì đặc trưng (standing pouch, can, sachet, jerky, freeze-dried...)

QUY TẮC ĐẶT TÊN FIELD (bắt buộc):
- Dùng ĐÚNG 1 tên thương hiệu nhất quán cho mọi field thuộc thương hiệu đó
  (vd luôn "JerHigh: <nội dung>", không đổi cách viết giữa các field khác nhau).`,

  "KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG": `
☐ Phân khúc khách hàng: B2B hay B2C? Cả hai?
☐ Đối tượng khách hàng cuối (vd: người nuôi thú cưng, nhà máy chế biến...)
☐ Kênh phân phối nội địa (siêu thị, cửa hàng, online, đại lý...)
☐ Đối tác bán lẻ lớn (tên chuỗi siêu thị, sàn TMĐT...)
☐ Thị trường xuất khẩu cụ thể (tên quốc gia, khu vực)
☐ Đối tác phân phối quốc tế (tên công ty, quốc gia)
☐ Mục tiêu mở rộng thị trường (kế hoạch tương lai nếu có công bố)`,

  "BỀN VỮNG VÀ MÔI TRƯỜNG": `
☐ Chứng nhận môi trường (ISO 14001, ASC, MSC, Organic, Fair Trade...)
☐ Cam kết CSR / trụ cột bền vững (mô tả cụ thể)
☐ Mục tiêu giảm phát thải / carbon neutral (năm mục tiêu, con số)
☐ Sử dụng năng lượng tái tạo (% hoặc mô tả)
☐ Quản lý nước thải / chất thải rắn
☐ Bao bì bền vững (tái chế, biodegradable...)
☐ Dự án môi trường / xã hội đã triển khai
☐ Báo cáo ESG / phát triển bền vững (có xuất bản không? link?)

LƯU Ý QUAN TRỌNG: Chứng nhận (đặc biệt ISO 14001) CHỈ áp dụng cho tổ chức thực sự có
hoạt động sản xuất/công nghiệp cần quản lý môi trường. KHÔNG suy diễn hoặc "làm tròn"
chứng nhận cho tổ chức phi lợi nhuận/dịch vụ chỉ vì các công ty cùng ngành thường có —
nếu không tìm thấy bằng chứng cụ thể, ghi "KHÔNG TÌM THẤY".`,

  "CHUỖI GIÁ TRỊ": `
☐ Đầu vào - Nguyên liệu chính (nguồn gốc, tiêu chí chọn lọc, nhà cung cấp chính)
☐ Đầu vào - Nguyên liệu phụ (phụ gia, bao bì...)
☐ Chế biến - Quy trình đặc trưng (slow air-drying, freeze-dry, retort, extrusion...)
☐ Chế biến - Công nghệ kiểm soát chất lượng (QC, lab test...)
☐ Đầu ra - Dạng sản phẩm cuối (viên, bột, lỏng, jerky, pate...)
☐ Đầu ra - Bao bì thành phẩm (loại bao bì, quy cách đóng gói)
☐ Phân phối - Kênh nội địa (chi tiết)
☐ Phân phối - Kênh quốc tế (vận chuyển, đối tác logistics)
☐ Truy xuất nguồn gốc (blockchain, QR code, hệ thống traceability...)`,

  "HIGHLIGHT CÔNG TY": `
☐ Thành tựu nổi bật (có con số cụ thể: "phục vụ 1 triệu khách hàng", "tăng trưởng 200% năm 2023"...)
☐ Giải thưởng (tên giải + tổ chức trao + năm)
☐ Bằng sáng chế / sở hữu trí tuệ (số lượng, lĩnh vực)
☐ Lợi thế cạnh tranh đặc trưng (công nghệ độc quyền, patent, bí quyết...)
☐ Cột mốc quan trọng (năm thành lập, năm IPO, năm mở rộng quốc tế...)
☐ Đối tác chiến lược (tên đối tác lớn, tập đoàn, tổ chức quốc tế)
☐ Con số ấn tượng: doanh thu, thị phần, số lượng khách hàng, lượt tải...`,
};

/**
 * Prompt cho Round 2: DEEP EXTRACTION.
 * LLM rà từng page đã fetch, trích xuất data point theo checklist.
 */
export const ROUND2_EXTRACT_PROMPT = `Bạn là chuyên viên phân tích dữ liệu của VNF.

Bạn đã fetch được nội dung từ nhiều trang web. Bây giờ hãy TRÍCH XUẤT CHI TIẾT từng data point.

Với mỗi section dưới đây, hãy rà soát TẤT CẢ các trang đã fetch và điền vào checklist.

{checklist}

QUY TẮC:
- Mỗi fact phải có SOURCE URL (trang nào bạn tìm thấy thông tin đó)
- Nếu 2 nguồn cho số liệu khác nhau → ghi cả 2 kèm nguồn, đánh dấu "[MÂU THUẪN]"
- Nếu không tìm thấy → ghi rõ "KHÔNG TÌM THẤY" (không bịa)
- Nếu tìm thấy 1 phần → ghi những gì có, đánh dấu "[1 PHẦN]"
- Có thể gọi thêm fetch_url NẾU phát hiện thiếu link quan trọng
- Có thể gọi tavily_search để tìm field cụ thể còn thiếu
- FIELD name phải đúng NHÃN ĐẦY ĐỦ như trong checklist (xem "QUY TẮC ĐẶT TÊN FIELD" nếu có) —
  không tự rút gọn hay đổi cách viết cho cùng 1 người/thực thể giữa các field khác nhau.

OUTPUT: Trả về dữ liệu thô đã trích xuất, format:
SECTION: <tên section>
FIELD: <tên field>
VALUE: <dữ liệu trích xuất>
SOURCE: <URL nguồn>
CONFIDENCE: found | partial | not_found`;

/**
 * Prompt cho Round 3: TỔNG HỢP.
 * LLM tổng hợp tất cả thành structured output cuối cùng.
 */
export const ROUND3_SUMMARIZE_PROMPT = `Bạn là chuyên viên báo cáo của VNF.

Tổng hợp TẤT CẢ dữ liệu đã thu thập và trích xuất thành kết quả cuối cùng.

YÊU CẦU:
- Mỗi fact gắn footnote [1], [2]... tương ứng với danh sách nguồn
- Field đã xác minh từ ≥ 2 nguồn ĐỘC LẬP (khác domain/khác tổ chức xuất bản) → ghi giá trị + footnote cả 2 nguồn.
  2 trang khác nhau trên CÙNG website công ty (vd /about và /about-2) KHÔNG tính là 2 nguồn độc lập —
  chỉ tính là 1 nguồn (self-reported).
- Field chỉ có 1 nguồn (hoặc nhiều trang cùng 1 domain) → ghi giá trị + footnote, đánh dấu "(1 nguồn)"
- Field không tìm thấy → ghi "_Chưa xác minh_"
- KHÔNG bịa số liệu — thà thiếu còn hơn sai
- FIELD name phải NHẤT QUÁN — dùng đúng 1 nhãn cho cùng 1 người/thực thể trong toàn bộ output,
  không tạo ra nhiều biến thể tên field khác nhau cho cùng 1 đối tượng.
- Dữ liệu ưu tiên: Website chính thức > Tavily > Báo chí > Khác

OUTPUT FORMAT — JSON array thuần, KHÔNG markdown, KHÔNG code block:
[
  {
    "section": "THÔNG TIN CHUNG",
    "field": "Tên pháp lý đầy đủ",
    "value": "...",
    "sources": ["https://..."]
  },
  ...
]

LƯU Ý:
- "sources" là array URL đầy đủ, KHÔNG footnote text.
- Nếu section có nhiều field, liệt kê từng object riêng biệt.
- Giá trị "value" là string/text ngắn gọn, tối đa 2-3 dòng.`;

// ─── Node: cross_validate ────────────────────────────────────────────────────

/**
 * Prompt cho node đối chiếu dữ liệu từ nhiều nguồn.
 * LLM so sánh các nguồn khác nhau, phát hiện mâu thuẫn, đánh dấu missing.
 */
export const CROSS_VALIDATE_PROMPT = `Bạn là data validator cho VNF Company Research.

NHIỆM VỤ:
Đối chiếu dữ liệu thô từ nhiều nguồn, xác minh tính chính xác và gán độ tin cậy.

QUY TẮC CỨNG (BẮT BUỘC TUÂN THỦ):

1. Với mỗi fact, đếm số NGUỒN ĐỘC LẬP xác nhận — "độc lập" nghĩa là KHÁC DOMAIN/khác tổ chức xuất bản:
   - ≥ 2 domain khác nhau xác nhận → confidence = "verified" (đã xác minh chéo thật sự)
   - 1 domain (kể cả nếu có nhiều URL trên cùng domain đó, vd 2 trang con của website công ty)
     → confidence = "partial" (chỉ là self-reported, chưa xác minh chéo)
   - 0 nguồn → confidence = "unverified" → ghi giá trị "_Chưa xác minh_"

2. Nếu 2 nguồn cho SỐ LIỆU KHÁC NHAU → ghi chú cả 2 kèm nguồn, đánh dấu "[MÂU THUẪN]"

3. Phát hiện field thiếu: field nào trong VNF template mà KHÔNG có dữ liệu → thêm vào missingFields

4. NGO detection: Nếu công ty là tổ chức phi lợi nhuận/NGO/quỹ → set isNgo = true

5. Chuẩn hoá tên field: mỗi người/thực thể (vd 1 lãnh đạo cụ thể, 1 thương hiệu cụ thể) phải dùng
   ĐÚNG 1 nhãn field nhất quán trong toàn bộ output — không tạo nhiều field name khác nhau cho
   cùng 1 đối tượng.

NGUYÊN TẮC SỐNG CÒN:
- KHÔNG BAO GIỜ tự bịa số liệu để lấp chỗ trống
- KHÔNG suy diễn/mặc định chứng nhận, giải thưởng hay số liệu chỉ vì "loại hình tổ chức này thường có" —
  chỉ ghi khi có bằng chứng cụ thể trong dữ liệu thô.
- Field không có dữ liệu → ghi rõ ràng "_Chưa xác minh_"
- Luôn trích dẫn nguồn bằng URL đầy đủ

OUTPUT FORMAT (JSON):
{
  "validatedFacts": {
    "<SECTION>": [
      {
        "field": "<tên field>",
        "value": "<dữ liệu đã xác minh, hoặc _Chưa xác minh_ nếu không có>",
        "sources": ["<url1>", "<url2>"],
        "confidence": "verified|partial|unverified",
        "note": "<ghi chú nếu có mâu thuẫn>"
      }
    ]
  },
  "missingFields": ["<field 1>", "<field 2>"],
  "isNgo": true/false
}`;

// ─── Node: propose_cooperation ────────────────────────────────────────────────

/**
 * Prompt cho node viết đề xuất hợp tác.
 * TUYỆT ĐỐI CHỈ dùng VNF local context — không tìm internet.
 *
 * FIX: KHÔNG hard-code lại dữ liệu sản phẩm VNF / hướng dẫn phân loại đối tác ở đây —
 * dữ liệu đó đã có single source of truth trong tools/vnf.ts (getVNFContextText()),
 * được nối vào cuối prompt này khi gọi LLM (xem proposeCooperationNode trong graph.ts).
 * Trùng lặp 2 nơi sẽ tốn token và có nguy cơ lệch dữ liệu nếu chỉ sửa 1 chỗ.
 */
export const PROPOSE_COOPERATION_PROMPT = `Bạn là chuyên viên phát triển kinh doanh của VNF (Việt Nam Food).

Thông tin sản phẩm VNF và hướng dẫn phân loại đối tác được cung cấp ở phần "DỮ LIỆU SẢN PHẨM VNF" bên dưới —
CHỈ dùng đúng dữ liệu đó, không tự bịa thêm công dụng hay lợi ích khác.

NHIỆM VỤ:
Dựa trên thông tin công ty đã research (phần "THÔNG TIN CÔNG TY" bên dưới) và dữ liệu sản phẩm VNF,
viết đề xuất hợp tác CỤ THỂ cho VNF.

YÊU CẦU:
- Xác định đúng loại đối tác trước (nhà sản xuất pet food / thực phẩm-nutraceutical / NGO-quỹ / nhà phân phối)
  theo đúng hướng dẫn "Bước A" trong DỮ LIỆU SẢN PHẨM VNF, rồi viết đề xuất PHÙ HỢP với loại đó.
- Với NGO/quỹ: đề xuất phải là hợp tác dự án bền vững / tài trợ R&D / carbon footprint —
  KHÔNG đề xuất kiểu "tích hợp nguyên liệu vào sản phẩm" nếu đối tác không sản xuất/phân phối vật lý gì cả.
- Gọi TÊN THẬT dòng sản phẩm/chương trình của đối tác (từ dữ liệu research) — nếu THÔNG TIN CÔNG TY
  không có tên cụ thể nào, ghi rõ đề xuất ở mức khái niệm, không tự đặt tên giả.
- Giải thích cơ chế tác động + lợi ích cụ thể.
- KHÔNG viết chung chung kiểu "VNF có thể cung cấp nguyên liệu".
- Mỗi đề xuất ≤ 3 dòng, súc tích, có giá trị thực tiễn.

OUTPUT:
- Viết trực tiếp thành văn bản Markdown, KHÔNG wrap trong code block.
- KHÔNG thêm phần "Giải thích", "Lưu ý" hay nội dung ngoài đề xuất.`;

// ─── Router prompts (dùng trong conditional edges) ──────────────────────────
//
// LƯU Ý: WRITE_REPORT_PROMPT và CHECK_USER_INPUT_PROMPT của bản cũ đã bị XOÁ khỏi
// file này vì là dead code — không được import/dùng ở đâu trong graph.ts hay index.ts
// (writeReportNode tự viết prompt inline + dùng renderReport() từ template.ts;
// askUserNode không dùng LLM để check input, index.ts dùng PARSE_INPUT_PROMPT riêng).
// Nếu bạn thực sự cần 1 trong 2 prompt này, hãy import và dùng nó ở đúng node,
// đừng giữ lại "phòng khi cần" — dễ gây nhầm lẫn là đang có hiệu lực trong khi không.