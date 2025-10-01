# RSVP Vocab Trainer (React + Vite + Tailwind)

Một app học từ vựng kiểu RSVP: lia nhanh một tập từ, sau đó bạn nhập lại **mỗi từ một dòng**. Nếu đúng hết, **tăng kích thước tập** và xáo lại thứ tự.

## Tính năng chính
- Tải dữ liệu từ `/mock-be/words.json` (đặt trong thư mục `public/mock-be`).
- Màn hình Setup lần đầu: **Số từ ban đầu**, **Tốc độ (ms)**, **Số từ tăng mỗi lần pass**.
- Trong khi học: cấu hình **bị khoá**; muốn đổi phải **Reset**.
- RSVP hiển thị: **phiên âm** (trên), **từ** (to, giữa), **nghĩa** (dưới). Có **toggle** ẩn/hiện phiên âm & nghĩa.
- Kiểm tra: nhập **mỗi từ một dòng**, thứ tự **không** quan trọng. Hợp lệ khi gõ **kanji** hoặc **hiragana**.
- Lưu tiến trình & cấu hình vào `localStorage`.

## Chạy dự án
```bash
npm i
npm run dev
```
Mở URL console in ra (mặc định Vite là `http://localhost:5173`).

## Cấu trúc
- `public/mock-be/words.json` — dữ liệu từ vựng
- `src/components/*` — Setup, Trainer, RSVPDisplay, Recall
- `src/utils/shuffle.js` — tiện ích xáo trộn & chuẩn hoá chuỗi

## Ghi chú
- Khi PASS: tăng kích cỡ pool theo cấu hình (ví dụ +1), thêm từ **mới** vào pool (từ đầu danh sách lần lượt) và xáo lại.
- Khi FAIL: giữ nguyên pool, xáo lại và lặp tiếp.
- Khi đã thêm hết số từ trong dữ liệu, pool sẽ dừng ở kích thước tối đa.
