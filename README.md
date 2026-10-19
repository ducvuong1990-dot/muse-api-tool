# 🎪 Muse API Studio

Web tool (Node.js) để tương tác với Muse API gateway: **Chat**, **tạo Ảnh** và **tạo Video**.

- Chat streaming (SSE) trực tiếp trong trình duyệt, chọn model combo, đổi nhiệt độ, dừng giữa chừng
- Tạo ảnh (`muse-image`) → xem trước, mở/tải ảnh, gallery tạm
- Tạo video (`muse-video`) → poll tiến độ tự động, phát video khi xong, xem JSON thô
- API key nằm **ở server** (`.env`) — không lộ ra trình duyệt, không lỗi CORS
- **Trình quản lý hồ sơ kết nối**: nhiều hồ sơ (tên + Base URL + key) lưu trong trình duyệt,
  chuyển nhanh giữa các gateway; nút **🩺 Kiểm tra key** test thật qua server
- Tự xử lý "quirk" của gateway: `text/event-stream` sai cho phản hồi JSON, đuôi `data: [DONE]` thừa

## Quản lý key (⚙️ Cài đặt)

- **Hồ sơ kết nối**: mỗi hồ sơ = `{tên, Base URL, API key}`, lưu trong `localStorage`
  (key/base gửi qua header `x-user-key` / `x-base-url` — không nằm URL, không hiện log).
- Chọn `Dùng cấu hình .env` để quay về key trong `.env`.
- **🩺 Kiểm tra key**: server gọi `{base}/models` với key cho trước → báo
  hợp lệ (kèm số model) hoặc HTTP lỗi kèm lý do (401 = sai/thu hồi/tạm khóa).
- **Xác thực**: dùng nguyên gốc theo repo **muse2api** — key `m2a-…` tạo qua dashboard
  `/dashboard` hoặc `POST /admin/keys`; hướng dẫn đầy đủ xem
  [muse2api/README.md](muse2api/README.md) (bản gốc: https://github.com/www222fff/muse2api).

## Cài đặt & chạy

```bash
npm install
npm start          # → http://localhost:3000
```

Chế độ dev (tự khởi động lại khi sửa file):

```bash
npm run dev
```

## Cấu hình `.env`

```env
MUSE_API_KEY=sk-...            # key của bạn
MUSE_BASE_URL=https://your-gateway.example/v1   # base URL gateway của bạn
PORT=3000
```

> Server đọc key từ `.env`; trình duyệt **không bao giờ** nhận được key này.
> Muốn dùng key khác → ⚙️ **Cài đặt** trong giao diện (lưu trong localStorage, gửi qua header `x-user-key`).

## API nội bộ (server proxy)

| Method | Path | Upstream |
|---|---|---|
| GET  | `/api/config` | – (models, base URL; không lộ key) |
| POST | `/api/chat` | `POST /v1/chat/completions` (stream SSE khi `stream:true`) |
| POST | `/api/images` | `POST /v1/images/generations` |
| POST | `/api/videos` | `POST /v1/videos` |
| GET  | `/api/videos/:id` | `GET /v1/videos/:id` |

## Test không tốn quota (mock upstream)

Terminal 1 — chạy mock gateway:

```powershell
npm run mock
```

Terminal 2 — trỏ server vào mock:

```powershell
$env:MUSE_BASE_URL='http://127.0.0.1:3999/v1'
$env:MUSE_API_KEY='test'
$env:PORT='3210'
node server.js
```

Rồi mở `http://localhost:3210` — chat/ảnh/video đều hoạt động với dữ liệu giả.

## Troubleshooting

- **`401 API key required for remote API access`** — gateway từ chối key.
  Lỗi này trả về cho cả key **thiếu** lẫn key **không hợp lệ** (bị thu hồi/tạm khóa/hết hạn/sai).
  → Dùng nút **🩺 Kiểm tra key** trong ⚙️ Cài đặt để xác nhận nhanh.
- **`No credentials for provider: muse`** — lỗi **từ phía gateway** (chat dùng được nhưng
  ảnh/video thiếu credential provider). Không phải lỗi tool — chờ nhà cung cấp sửa.
- **Ảnh/video không hiện URL** — mở mục *JSON thô* của task để xem cấu trúc phản hồi thật,
  rồi chỉnh hàm `extractVideoUrl()` trong `public/app.js` cho khớp.
- Cổng bị chiếm: đổi `PORT` trong `.env`.
