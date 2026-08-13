---
name: vnf-company-research
description: Use this skill whenever the user provides a company/organization website URL and wants structured business-intelligence research in the VNF (Vietnam Food) Company Research format. Triggers include any message with a company URL + phrases like "research công ty này", "tìm hiểu công ty", "company research", "bioscan", "làm hồ sơ công ty", "tạo bảng nghiên cứu", "VNF company research", or just a bare URL when context is about partner/customer/competitor research. Also trigger when user references the company-research template and wants output for a company. Use proactively for any company-profile request from VNF users — even casual phrasing like "tìm hiểu giúp tôi công ty này" or "check xem công ty này thế nào".
---

# VNF Company Research Skill

Skill chuẩn của VNF để biến **một đường link website công ty** thành **báo cáo Company Research** theo đúng format nội bộ VNF — dựa trên các mẫu IPF, Global Pet's Food, Magnuson Trust đã được phê duyệt.

---

## Bối cảnh VNF

VNF (Công ty Cổ phần Việt Nam Food) là nhà sản xuất nguyên liệu chức năng từ phụ phẩm tôm tại Cà Mau, Việt Nam. Ba sản phẩm cốt lõi cần lồng ghép vào mọi phần **ĐỀ XUẤT HỢP TÁC**:

| Sản phẩm | Công dụng chính |
|----------|----------------|
| **Peptide tôm** | Cung cấp amino acid sinh học dễ hấp thu · tăng miễn dịch · phục hồi cơ bắp · hỗ trợ xương khớp · palatant kích thích ăn (umami tự nhiên) · tổng hợp collagen |
| **Chitosan** | Cân bằng hệ vi sinh đường ruột · hỗ trợ tiêu hóa & thải độc · bảo vệ gan thận · kháng khuẩn răng miệng · chất bảo quản tự nhiên · kiểm soát cân nặng |
| **Astaxanthin** | Chống oxy hóa mạnh · bảo vệ da-mắt-thần kinh · làm đẹp lông/da thú cưng · chống lão hóa · tăng sức đề kháng · sắc tố tự nhiên |

---

## Quy trình thực hiện

### Bước 1 — Hỏi user 2 điều trước khi research

Dùng `AskUserQuestion` hỏi **một lần, gộp trong 1 lần gọi tool**:

1. **Ngôn ngữ output:** Tiếng Việt / Tiếng Anh / Song ngữ Việt–Anh.
2. **Lý do VNF quan tâm:** User mô tả ngắn gọn lý do (ví dụ: "Đối tác phân phối thức ăn thú cưng tại Thái Lan", "Khách hàng tiềm năng mua Peptide tôm", "Đối thủ cạnh tranh"). Nếu user bỏ trống, tự suy luận từ ngành nghề công ty.

> Không hỏi thêm gì khác. Mục tiêu là bắt đầu research nhanh nhất có thể.

### Bước 2 — Thu thập dữ liệu

**2a. Fetch website chính** bằng `WebFetch`. Nếu site JavaScript-rendered (trả về shell rỗng hoặc loading spinner), chuyển ngay sang `mcp__Claude_in_Chrome__navigate` + `mcp__Claude_in_Chrome__get_page_text` — **không retry WebFetch**.

Các trang cần crawl theo thứ tự ưu tiên:
- Trang chủ → `/about`, `/about-us`, `/company`, `/our-story`
- `/team`, `/leadership`, `/management`, `/board`, `/who-we-are`
- `/products`, `/brands`, `/portfolio`, `/solutions`
- `/contact`, `/factory`, `/sustainability`, `/news`, `/press`

**2b. WebSearch bổ sung** cho các trường website không có:
- Ngày thành lập, vốn đăng ký, cơ cấu sở hữu → báo chí, Crunchbase, LinkedIn, đăng ký doanh nghiệp nước đó.
- Ban lãnh đạo background → LinkedIn, báo ngành, press release.
- Thị trường xuất khẩu, chứng nhận chất lượng, giải thưởng → báo ngành, trang chứng nhận (BRC, IFS, ISO...).
- Doanh thu / quy mô nhân sự → báo cáo tài chính công khai, media.

**Nguyên tắc dữ liệu:**
- Mỗi fact cần có nguồn truy được. Ghi `_Chưa xác minh_` nếu không tìm được sau 2 lần search ở 2 nguồn khác nhau.
- **Không bịa con số.** Thà trống còn hơn sai — VNF dùng báo cáo này để ra quyết định kinh doanh.

### Bước 3 — Viết báo cáo

Xem `references/template.md` để biết khung bảng chính xác và hướng dẫn điền từng hàng.

**Tên file output:** `Company_Research_<TÊN_VIẾT_TẮT>.md`
Ví dụ: `Company_Research_IPF.md`, `Company_Research_GPF.md`

Lưu file vào workspace folder của user.

### Bước 4 — Trả kết quả

Kết thúc bằng:
- Link `computer://` tới file Markdown đã lưu.
- 2–3 dòng nhận xét "so what" cho VNF — điểm nào nên khai thác ngay khi tiếp cận.
- Liệt kê các trường `_Chưa xác minh_` để user biết chỗ nào cần verify thủ công.

---

## Cấu trúc báo cáo

Báo cáo gồm 2 phần chính. Chi tiết đầy đủ xem `references/template.md`.

### Phần mở đầu
- Đoạn giới thiệu 3–5 dòng: ngành nghề, định vị thị trường, điểm nổi bật.
- 3–5 bullet ✓ highlight key facts (ví dụ: "✓ Top 1 thức ăn vặt cho chó tại Thái Lan").

### A. THÔNG TIN TỔNG QUAN (bảng 2 cột: nhãn | nội dung)

| Hàng | Nội dung cần điền |
|------|-------------------|
| **THÔNG TIN CHUNG** | Tên pháp lý · Ngày đăng ký · Trụ sở chính · Website · Mạng xã hội (LinkedIn, LINE...) · Hotline/Email · **Key figures:** Vốn đăng ký, Cơ cấu sở hữu, Quy mô thị trường, Nhân sự |
| **LÃNH ĐẠO** | Mỗi người 1 block: **Họ tên – Chức danh** · Tóm tắt trách nhiệm chính · LinkedIn (N/A nếu không tìm được) |
| **HOẠT ĐỘNG KINH DOANH** | Lĩnh vực · Thương hiệu sản phẩm chính · Thị trường nội địa & quốc tế · Tiêu chuẩn chất lượng (GMP, HACCP, ISO, BRC...) |
| **NHÀ MÁY** | Địa chỉ từng nhà máy · Vai trò · Công suất (tấn/năm hoặc units/giờ) · Quy trình & công nghệ cốt lõi · Chứng nhận nhà máy |
| **DANH MỤC SẢN PHẨM** | Phân chia theo thương hiệu → theo dòng sản phẩm. Nếu quá chi tiết → tóm tắt ở đây, full catalog xuống B. APPENDIX |
| **KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG** | Phân khúc khách hàng (B2B/B2C) · Kênh phân phối · Đối tác bán lẻ · Thị trường xuất khẩu cụ thể |
| **BỀN VỮNG VÀ MÔI TRƯỜNG** | Chứng nhận môi trường · Cam kết CSR · Mục tiêu phát thải · Dự án bền vững đã triển khai |
| **CHUỖI GIÁ TRỊ** | **Đầu vào:** nguồn nguyên liệu, tiêu chí chọn lọc · **Chế biến:** quy trình, công nghệ · **Đầu ra:** dạng sản phẩm, bao bì · **Phân phối:** kênh nội địa & quốc tế |
| **HIGHLIGHT CÔNG TY** | Thành tựu nổi bật · Giải thưởng · Lợi thế cạnh tranh · Con số ấn tượng (doanh thu, tăng trưởng, thị phần) |
| **ĐỀ XUẤT HỢP TÁC** | Phân tích cụ thể VNF có thể đề xuất gì — xem hướng dẫn chi tiết bên dưới |

> **Lưu ý cho tổ chức NGO / quỹ:** Thay hàng NHÀ MÁY và DANH MỤC SẢN PHẨM bằng **CÁC DỰ ÁN ĐÃ TRIỂN KHAI** (như mẫu Magnuson Trust).

### B. APPENDIX (tùy chọn)
Dành cho công ty có danh mục sản phẩm lớn (ví dụ: IPF với 30+ SKU). Format: bảng PHÂN LOẠI | THÔNG TIN SẢN PHẨM với tên sản phẩm, công dụng, thành phần chính, và đề xuất VNF ingredients cho từng SKU.

---

## Hướng dẫn viết ĐỀ XUẤT HỢP TÁC

Đây là phần quan trọng nhất — VNF dùng để chuẩn bị pitch với đối tác. Viết cụ thể, không chung chung.

**Bước A — Xác định loại đối tác:**
- **Nhà sản xuất pet food:** Đề xuất lồng Peptide tôm, Chitosan, Astaxanthin vào từng dòng sản phẩm cụ thể (gọi đúng tên dòng thật của họ, không tên giả).
- **Nhà sản xuất thực phẩm / nutraceutical cho người:** Tương tự, focus vào human health claims.
- **Tổ chức phi lợi nhuận / quỹ:** Đề xuất hợp tác dự án bền vững, tài trợ R&D, hoặc carbon footprint reduction (VNF upcycles 100% phụ phẩm tôm).
- **Nhà phân phối / importer:** Đề xuất thêm sản phẩm VNF vào danh mục phân phối của họ.

**Bước B — Với mỗi sản phẩm VNF, giải thích:**
1. Ứng dụng cụ thể vào sản phẩm/dòng nào của đối tác.
2. Cơ chế / lợi ích tương thích với công thức hiện có.
3. Giá trị gia tăng cho sản phẩm cuối (functional claim, palatability, shelf-life, natural colorant...).

**Ví dụ tốt (từ mẫu IPF):**
```
• Peptide tôm: Ứng dụng trong JerHigh 2in1 Stick như palatant kích thích ăn ngon,
  cung cấp amino acid dễ hấp thu. Ứng dụng trong Terpene Stick và Jinny Creamy
  Treat – Immune / Brain & Eye.
• Chitosan: Ứng dụng trong Jinny Digestive / Urinary Health — cân bằng hệ vi sinh,
  bảo vệ thận, hạn chế sỏi niệu. Kết hợp JerHigh Carrot & Spinach để giảm mùi phân.
• Astaxanthin: Ứng dụng trong JerHigh Beauty Formula và JerHigh Gold — chống oxy
  hóa, sáng lông da, bảo vệ mắt. Kết hợp Omega-3,6 tăng hiệu quả da và lông.
```

**Không chấp nhận:** "VNF có thể cung cấp nguyên liệu cho công ty này." → Quá chung, không có giá trị.

---

## Nguyên tắc văn phong

- **Tone:** Trang trọng, súc tích, bullet ngắn, có con số cụ thể kèm năm và đơn vị.
- **Mỗi bullet = 1 fact cụ thể.** Câu chung chung → đào sâu thêm hoặc ghi `_Chưa xác minh_`.
- **Trích nguồn:** Mỗi fact gắn footnote `[1]`, `[2]`... rồi liệt kê đầy đủ cuối báo cáo với link.
- **Tránh marketing-speak** ("hàng đầu", "uy tín nhất") trừ khi trích nguyên văn từ nguồn có link.

---

## Edge cases

| Tình huống | Cách xử lý |
|------------|-----------|
| URL là LinkedIn / Facebook của công ty | Vẫn dùng được. Tìm website chính trong bio để bổ sung. |
| Website JavaScript-rendered | Dùng Claude in Chrome ngay, không retry WebFetch. |
| Công ty rất nhỏ / ít thông tin công khai | Vẫn làm báo cáo, ghi rõ ở đầu "Thông tin công khai hạn chế." |
| Tổ chức NGO / quỹ từ thiện | Thay NHÀ MÁY + DANH MỤC SẢN PHẨM bằng CÁC DỰ ÁN ĐÃ TRIỂN KHAI. |
| Công ty nước ngoài | Giữ nguyên template, điều chỉnh tên trường pháp lý phù hợp nước đó. |
| Không tìm được lãnh đạo | Ghi `_Chưa xác minh_`. Bỏ hàng LÃNH ĐẠO nếu hoàn toàn trống. |
| Công ty OEM / private label | Thêm chi tiết năng lực OEM vào DANH MỤC SẢN PHẨM và HOẠT ĐỘNG KINH DOANH. |
