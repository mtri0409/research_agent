/**
 * VNF Product Context
 *
 * Dữ liệu sản phẩm VNF dùng cho phần ĐỀ XUẤT HỢP TÁC.
 * TUYỆT ĐỐI KHÔNG tìm kiếm trên internet — chỉ dùng dữ liệu local này.
 *
 * Nguồn: VNF Company Research SKILL.md
 */

/** Thông tin 3 sản phẩm cốt lõi của VNF */
export const VNF_PRODUCTS = {
  company: {
    name: "VNF (Công ty Cổ phần Việt Nam Food)",
    location: "Cà Mau, Việt Nam",
    description:
      "Nhà sản xuất nguyên liệu chức năng từ phụ phẩm tôm — upcycles 100% phụ phẩm tôm.",
  },
  products: [
    {
      name: "Peptide tôm",
      keyBenefits: [
        "Cung cấp amino acid sinh học dễ hấp thu",
        "Tăng miễn dịch",
        "Phục hồi cơ bắp",
        "Hỗ trợ xương khớp",
        "Palatant kích thích ăn (umami tự nhiên)",
        "Tổng hợp collagen",
      ],
      applications: {
        "pet food": "Palatant tự nhiên kích thích ăn ngon, amino acid dễ hấp thu cho thú cưng",
        "human food": "Bổ sung amino acid sinh học, hỗ trợ phục hồi cơ bắp",
        aquaculture: "Kích thích ăn, tăng trưởng cho tôm/cá",
      },
    },
    {
      name: "Chitosan",
      keyBenefits: [
        "Cân bằng hệ vi sinh đường ruột",
        "Hỗ trợ tiêu hóa & thải độc",
        "Bảo vệ gan thận",
        "Kháng khuẩn răng miệng",
        "Chất bảo quản tự nhiên",
        "Kiểm soát cân nặng",
      ],
      applications: {
        "pet food": "Cân bằng vi sinh đường ruột, giảm mùi phân, bảo vệ thận, hạn chế sỏi niệu",
        "human food": "Hỗ trợ tiêu hóa, thải độc, kiểm soát cân nặng",
        preservation: "Chất bảo quản tự nhiên thay thế hóa chất tổng hợp",
      },
    },
    {
      name: "Astaxanthin",
      keyBenefits: [
        "Chống oxy hóa mạnh",
        "Bảo vệ da-mắt-thần kinh",
        "Làm đẹp lông/da thú cưng",
        "Chống lão hóa",
        "Tăng sức đề kháng",
        "Sắc tố tự nhiên",
      ],
      applications: {
        "pet food": "Chống oxy hóa, sáng lông da, bảo vệ mắt, kết hợp Omega-3,6 tăng hiệu quả",
        "human food": "Chống lão hóa, bảo vệ da và mắt, tăng sức đề kháng",
        cosmetics: "Sắc tố tự nhiên, chống oxy hóa cho mỹ phẩm",
      },
    },
  ],
};

/**
 * Hướng dẫn phân loại đối tác để viết đề xuất.
 * Dùng trong prompt cho LLM ở bước propose_cooperation.
 */
export const VNF_PARTNER_GUIDE = `
## Hướng dẫn viết ĐỀ XUẤT HỢP TÁC

### Bước A — Xác định loại đối tác:
- **Nhà sản xuất pet food:** Đề xuất lồng Peptide tôm, Chitosan, Astaxanthin vào từng dòng sản phẩm cụ thể (gọi đúng tên dòng thật của họ, không tên giả).
- **Nhà sản xuất thực phẩm / nutraceutical cho người:** Tương tự, focus vào human health claims.
- **Tổ chức phi lợi nhuận / quỹ:** Đề xuất hợp tác dự án bền vững, tài trợ R&D, hoặc carbon footprint reduction (VNF upcycles 100% phụ phẩm tôm).
- **Nhà phân phối / importer:** Đề xuất thêm sản phẩm VNF vào danh mục phân phối của họ.

### Bước B — Với mỗi sản phẩm VNF, giải thích:
1. Ứng dụng cụ thể vào sản phẩm/dòng nào của đối tác.
2. Cơ chế / lợi ích tương thích với công thức hiện có.
3. Giá trị gia tăng cho sản phẩm cuối (functional claim, palatability, shelf-life, natural colorant...).

### Ví dụ tốt:
- Peptide tôm: Ứng dụng trong [TÊN DÒNG SẢN PHẨM THẬT] như palatant kích thích ăn ngon, cung cấp amino acid dễ hấp thu.
- Chitosan: Ứng dụng trong [TÊN DÒNG] — cân bằng hệ vi sinh, bảo vệ thận, hạn chế sỏi niệu.
- Astaxanthin: Ứng dụng trong [TÊN DÒNG] — chống oxy hóa, sáng lông da, bảo vệ mắt.

### Không chấp nhận:
"VNF có thể cung cấp nguyên liệu cho công ty này." → Quá chung, không có giá trị.
`;

/**
 * Format VNF product info thành text context cho LLM prompt.
 */
export function getVNFContextText(): string {
  const parts: string[] = [
    `**${VNF_PRODUCTS.company.name}** — ${VNF_PRODUCTS.company.location}`,
    VNF_PRODUCTS.company.description,
    "",
    "### Sản phẩm cốt lõi:",
  ];

  for (const p of VNF_PRODUCTS.products) {
    parts.push(`\n**${p.name}:**`);
    parts.push(...p.keyBenefits.map((b) => `  • ${b}`));
  }

  parts.push("\n---\n");
  parts.push(VNF_PARTNER_GUIDE);

  return parts.join("\n");
}
