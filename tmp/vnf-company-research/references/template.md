# Template VNF Company Research — Khung bảng chính xác

Đây là template Markdown để render báo cáo Company Research của VNF.
Sao chép khung bên dưới, điền nội dung vào từng ô, xóa hướng dẫn trong ngoặc vuông.

---

## PHẦN MỞ ĐẦU

```markdown
[Đoạn intro 3–5 dòng: mô tả công ty, ngành nghề, định vị, điểm đặc trưng nhất.
Viết như đoạn executive summary — không bullet ở đây.]

✓ [Key fact 1 — con số hoặc thành tựu cụ thể]
✓ [Key fact 2]
✓ [Key fact 3]
✓ [Key fact 4 — nếu có]
```

---

## A. THÔNG TIN TỔNG QUAN

Dùng bảng Markdown 2 cột. Cột trái là nhãn section (in đậm), cột phải là nội dung dạng bullet.

```markdown
| | |
|---|---|
| **THÔNG TIN CHUNG** | • **Tên pháp lý:** [Tên đầy đủ theo đăng ký]<br>• **Ngày đăng ký:** [DD/MM/YYYY hoặc năm]<br>• **Trụ sở chính:** [Địa chỉ đầy đủ]<br>• **Website:** [URL]<br>• **LinkedIn:** [URL hoặc N/A]<br>• **Email / Hotline:** [email hoặc số điện thoại]<br>• **Key figures:**<br>&nbsp;&nbsp;○ **Vốn đăng ký:** [số tiền + đơn vị tiền tệ]<br>&nbsp;&nbsp;○ **Cơ cấu sở hữu:** [cổ đông chính + % nếu có]<br>&nbsp;&nbsp;○ **Quy mô thị trường / Vị trí:** [ví dụ: Top 1 pet snack tại Thái Lan]<br>&nbsp;&nbsp;○ **Nhân sự:** [số lượng hoặc khoảng] |
| **LÃNH ĐẠO** | **[Họ và tên] — [Chức danh]**<br>• [Mô tả trách nhiệm chính 1–2 dòng]<br>• LinkedIn: [URL hoặc N/A]<br><br>**[Họ và tên 2] — [Chức danh 2]**<br>• [Mô tả trách nhiệm]<br>• LinkedIn: [URL hoặc N/A] |
| **HOẠT ĐỘNG KINH DOANH** | • **Lĩnh vực:** [Mô tả ngành nghề chính]<br>• **Thương hiệu sản phẩm chính:**<br>&nbsp;&nbsp;○ [Thương hiệu A]: [mô tả ngắn — phân khúc, loài, dòng]<br>&nbsp;&nbsp;○ [Thương hiệu B]: [mô tả ngắn]<br>• **Thị trường:**<br>&nbsp;&nbsp;○ **Nội địa:** [phân phối qua kênh nào]<br>&nbsp;&nbsp;○ **Quốc tế:** [số quốc gia + tên thị trường chính]<br>• **Tiêu chuẩn chất lượng:**<br>&nbsp;&nbsp;○ [GMP / HACCP / ISO 9001 / ISO 14001 / BRC / IFS / ASC / MSC...] — [mô tả ngắn ý nghĩa] |
| **NHÀ MÁY** | • **Nhà máy [tên/địa điểm]:** [địa chỉ đầy đủ]<br>&nbsp;&nbsp;○ Vai trò: [sản xuất gì]<br>&nbsp;&nbsp;○ Công suất: [con số cụ thể — tấn/năm, units/giờ...]<br>&nbsp;&nbsp;○ Công nghệ: [mô tả quy trình/công nghệ đặc trưng]<br><br>• **Nhà máy 2 (nếu có):** [tương tự]<br><br>• **Chứng nhận nhà máy:** [danh sách]<br>• **Quy trình sản xuất:** [các công đoạn chính: xay – trộn – tạo hình – sấy – đóng gói...] |
| **DANH MỤC SẢN PHẨM** | **[Thương hiệu A]:**<br>• [Dòng 1]: [mô tả — loại sản phẩm, thành phần chính, công dụng]<br>• [Dòng 2]: [mô tả]<br><br>**[Thương hiệu B]:**<br>• [Dòng 1]: [mô tả]<br><br>_Xem chi tiết từng SKU tại B. APPENDIX_ [nếu có nhiều sản phẩm]<br><br>• Ngoài ra: cung cấp dịch vụ OEM/ODM [nếu có] |
| **KHÁCH HÀNG & MỤC TIÊU THỊ TRƯỜNG** | • **Khách hàng:**<br>&nbsp;&nbsp;○ [Phân khúc 1 — ví dụ: Người nuôi thú cưng]<br>&nbsp;&nbsp;○ [Phân khúc 2 — ví dụ: Cửa hàng thú cưng, siêu thị]<br>&nbsp;&nbsp;○ [Phân khúc 3 — ví dụ: Đối tác B2B / OEM]<br>• **Mục tiêu thị trường:** [định hướng mở rộng]<br>• **Đối tác phân phối tiêu biểu:** [tên chuỗi bán lẻ, nền tảng e-commerce] |
| **BỀN VỮNG VÀ MÔI TRƯỜNG** | • [Chứng nhận môi trường: ISO 14001, ASC, MSC...] — [mô tả ngắn]<br>• [Cam kết CSR / trụ cột bền vững]<br>• **Các mục tiêu môi trường chính:**<br>&nbsp;&nbsp;○ [Giảm phát thải / năng lượng tái tạo / quản lý nước...]<br>&nbsp;&nbsp;○ [Quản lý chất thải và bao bì]<br>• [Dự án môi trường đã triển khai — nếu có] |
| **CHUỖI GIÁ TRỊ** | • **Đầu vào:**<br>&nbsp;&nbsp;○ Nguyên liệu chính: [nguồn, tiêu chí chọn lọc]<br>&nbsp;&nbsp;○ Nguyên liệu phụ: [danh sách]<br>• **Chế biến:**<br>&nbsp;&nbsp;○ [Quy trình đặc trưng — ví dụ: slow air-drying, freeze-dry, retort...]<br>&nbsp;&nbsp;○ [Công nghệ kiểm soát chất lượng]<br>• **Đầu ra:**<br>&nbsp;&nbsp;○ [Dạng sản phẩm cuối — ví dụ: Hard Snack, Wet Food, Jerky...]<br>&nbsp;&nbsp;○ [Bao bì: Standing Pouch, Sachet, Can...]<br>• **Phân phối:**<br>&nbsp;&nbsp;○ Nội địa: [kênh — supermarket, pet shop, e-commerce]<br>&nbsp;&nbsp;○ Quốc tế: [số quốc gia, đối tác phân phối] |
| **HIGHLIGHT CÔNG TY** | • [Thành tựu 1 — có con số cụ thể]<br>• [Thành tựu 2]<br>• **Giải thưởng:**<br>&nbsp;&nbsp;○ [Tên giải + tổ chức trao + năm]<br>&nbsp;&nbsp;○ [Tên giải + ...]<br>• [Lợi thế cạnh tranh đặc trưng — ví dụ: 100% truy xuất nguồn gốc, Human Grade...] |
| **ĐỀ XUẤT HỢP TÁC** | • **Peptide tôm:** [Ứng dụng cụ thể vào sản phẩm nào của đối tác + cơ chế tác động]<br>• **Chitosan:** [Ứng dụng cụ thể + lợi ích]<br>• **Astaxanthin:** [Ứng dụng cụ thể + lợi ích]<br><br>_Xem hướng dẫn viết ĐỀ XUẤT HỢP TÁC trong SKILL.md_ |
```

---

## B. APPENDIX (chỉ thêm khi công ty có nhiều sản phẩm)

```markdown
## B. APPENDIX

### 1. [Thương hiệu A] — [Dòng sản phẩm X]

| PHÂN LOẠI | THÔNG TIN SẢN PHẨM |
|-----------|-------------------|
| **[Tên SKU]** | • **Công dụng:** [mô tả công dụng chính]<br>• **Thành phần:**<br>&nbsp;&nbsp;○ [Thành phần 1]<br>&nbsp;&nbsp;○ [Thành phần 2]<br>• **Đặc điểm:** [Human Grade / Grain-Free / No preservatives...]<br>• **Đề xuất VNF:**<br>&nbsp;&nbsp;○ **Peptide tôm:** [ứng dụng cụ thể]<br>&nbsp;&nbsp;○ **Chitosan:** [ứng dụng cụ thể]<br>&nbsp;&nbsp;○ **Astaxanthin:** [ứng dụng cụ thể] |
| **[Tên SKU 2]** | [tương tự] |
```

---

## PHẦN NGUỒN THAM KHẢO

```markdown
---
**Nguồn tham khảo:**

[1] [Tên nguồn] — [URL đầy đủ]
[2] [Tên nguồn] — [URL đầy đủ]
[3] ...
```

---

## Lưu ý khi render Markdown

- Dùng `<br>` để xuống dòng trong ô bảng.
- Dùng `&nbsp;&nbsp;` để thụt lề trong ô bảng.
- Nhãn cột trái (THÔNG TIN CHUNG, LÃNH ĐẠO...) viết **in đậm** và chữ hoa toàn bộ.
- Mỗi lãnh đạo trong hàng LÃNH ĐẠO cách nhau bằng 1 dòng trống (`<br><br>`).
- Nếu một hàng quá dài (ví dụ DANH MỤC SẢN PHẨM), được phép chia thành nhiều hàng bảng liên tiếp với cùng nhãn.
- Trường không tìm được dữ liệu: ghi `_Chưa xác minh_` — không bỏ trống hoàn toàn.
