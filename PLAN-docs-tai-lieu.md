# Kế hoạch: tài liệu hướng dẫn eVoice Studio (`/tai-lieu`)

Ngày lập: 2026-11-14. Trạng thái: **chỉ là kế hoạch**. Chưa viết code, chưa gọi API, chưa push hay deploy.

Mục tiêu:
- Mỗi tính năng của app desktop Electron có một bài hướng dẫn bằng tiếng Việt tự nhiên.
- Lời văn do Gemini viết qua Gemini API.
- Mỗi bước có ảnh chụp màn hình thật, chụp tự động và chụp lại được.
- Đăng ở `https://evoice.elevatemarketing.vn/tai-lieu` và có mục "Tài liệu" trong menu header của landing.

---

## 0. Thực trạng đã khảo sát

| Hạng mục | Thực tế |
|---|---|
| Route của app | `electron/src/renderer/src/routes/index.ts`. Menu lấy từ `components/app-shell/destinations.ts`. |
| Tên trang tiếng Việt | `i18n/locales/vi.json`: Nhân bản, Thiết kế, Đã lưu, Thư viện, Truyện, Sách nói, Studio âm nhạc, Lồng tiếng, Lồng tiếng hàng loạt, Phiên âm, Quy trình, Công cụ, Tích hợp, Dự án. |
| Promo video, Video editor | **Chưa có trên nhánh này.** `/promo` và `/editor` mới nằm trên các nhánh chưa merge (`feat/promo-hyperframes`, `feat/video-editor-pro`, `build/ui-promo`). |
| Harness chụp có sẵn | `electron/tests/desktop-harness.mjs` mở app bằng Playwright `_electron`, chạy với backend giả (`fake-health-backend.mjs`), chặn mọi request ra ngoài máy (`request-guard.cjs`) và tự seed `localStorage`. Playwright `^1.64.1` đã có trong `package.json` gốc. |
| Hạn chế của harness | Fixture mặc định trống: không có giọng, model hay engine. Seed đặt `voicestudio.locale = 'en'`. Profile tạm nằm trong `%TEMP%`, nên đường dẫn có tên người dùng Windows. |
| Theme | Lưu ở `localStorage['voicestudio.theme.v2']`, áp vào `data-theme-id` trên `<html>`. Xem `tests/theme-picker-smoke.mjs`. |
| Landing | `D:\App Design\Voice Studio\index.html`: một file 109 KB, CSS inline, chỉ có theme tối. Nội dung song ngữ Việt/Anh qua khóa `data-i18n="tNN"` và nút `lang-toggle`. Repo `elevatevietnamai-lang/evoice-landing`; mỗi lần push lên `main` thì Vercel tự deploy. |
| Tài liệu hiện có | `docs/feature-catalog.md`, `docs/electron-*.md`, `docs/dub-hardsub.md`, `docs/music-studio.md`, `docs/voice-design.md`, `docs/features/dictation.md`, `docs/install/*`. Đây là nguồn dữ kiện đầu vào cho Gemini, viết bằng tiếng Anh. |

---

## 1. Danh sách bài và dàn ý

Mỗi bài theo cùng một khung:
1. Tính năng này làm gì (2–3 câu).
2. Cần chuẩn bị gì (model, file đầu vào).
3. Các bước, mỗi bước kèm một ảnh.
4. Mẹo.
5. Lỗi thường gặp và cách xử lý.
6. Bài liên quan.

| # | Slug | Bài | Route / nguồn code | Dàn ý chính (các bước có ảnh) |
|---|---|---|---|---|
| 1 | `bat-dau` | Bắt đầu với eVoice Studio | Trang chủ `/`, màn thiết lập lần đầu, `/settings/models` | Cài app (lấy từ `docs/install/windows.md`, `macos.md`, `linux.md`) → lần mở đầu và hỏi đồng ý analytics → tải model đầu tiên → tham quan thanh điều hướng và Trang chủ → chọn ngôn ngữ và theme |
| 2 | `nhan-ban-giong` | Nhân bản giọng | `/clone` (`features/clone/*`) | Thêm audio mẫu (tải lên hoặc ghi âm) → chép lời mẫu (ASR) → xem điểm chất lượng audio → nhập kịch bản → chọn engine và ngôn ngữ → tạo audio → nghe bản tạo và lưu thành giọng → khóa nhận dạng giọng, xác nhận quyền dùng giọng |
| 3 | `giong-da-luu` | Quản lý giọng đã lưu | `/personas` | Danh sách giọng → sửa tên và ảnh đại diện → thay audio mẫu → xuất và nhập persona → xem giọng đang được dùng ở đâu |
| 4 | `thiet-ke-giong` | Thiết kế giọng bằng mô tả | `/design` | Viết mô tả hoặc chọn preset tính cách → tạo bản nghe thử → chỉnh → lưu thành giọng |
| 5 | `thu-vien-giong` | Thư viện giọng | `/gallery` | Duyệt và lọc → nghe thử → thêm vào yêu thích → nhập giọng → thư viện cộng đồng (gọi mạng; nói rõ chỉ chạy khi người dùng bật) |
| 6 | `long-tieng-video` | Lồng tiếng video | `/dub` (`features/dub/*`, `docs/electron-dubbing.md`, `docs/dub-hardsub.md`) | Mở video hoặc dự án → chép lời và tách người nói → dịch, kèm bảng thuật ngữ → gán giọng cho từng nhân vật → sửa trên timeline → nhạc nền (BGM) → phụ đề cứng (hardsub) → xuất file → lưu dự án |
| 7 | `long-tieng-hang-loat` | Lồng tiếng hàng loạt | `/batch` | Thêm nhiều video → chọn cấu hình → thư mục theo dõi (watch folder) → theo dõi tiến độ hàng đợi |
| 8 | `truyen` | Truyện nhiều giọng | `/stories` (`features/longform/*`) | Nhập hoặc dán truyện → tự phân vai → gán giọng → nghe thử từng đoạn → tạo → xuất stems |
| 9 | `sach-noi` | Sách nói | `/audiobook` (cùng `longform-page`) | Nhập sách → đánh dấu chương → cài đặt sách → tạo → trình phát có chữ chạy theo audio → xuất cue sheet |
| 10 | `studio-am-nhac` | Studio âm nhạc | `/music`, `docs/music-studio.md` | Cài ACE-Step → viết prompt và lời → tạo → nghe và tải về. **Chờ** PR #16 (sửa luồng cài ACE-Step) và kế hoạch nâng cấp ace-step-ui; viết sau cùng trong nhóm này. |
| 11 | `phien-am` | Phiên âm và đọc chính tả | `/transcriptions`, `features/transcriptions/*`, `docs/features/dictation.md` | Chép lời một file → lịch sử phiên âm → bật đọc chính tả trực tiếp → đặt phím tắt → widget thu âm nổi |
| 12 | `quy-trinh` | Quy trình tự động | `/calls` (render `WorkflowsPage`), `docs/electron-workflows.md` | Tạo quy trình → nối các bước trên canvas → chạy → xem kết quả |
| 13 | `cong-cu` | Công cụ: so sánh và chuyển giọng | `/tools` (`compare-voices`, `convert-voice`) | So sánh hai giọng → chuyển giọng của một file audio sang giọng đã lưu |
| 14 | `tich-hop` | Tích hợp | `/integrations`, `/integrations/$slug`, `docs/mcp.md`, `docs/integration-directory.md` | Danh sách tích hợp → mở chi tiết → bật (MCP, API cục bộ) |
| 15 | `du-an` | Dự án | `/projects` | Mở, đổi tên, nhân bản, xóa dự án; dự án lồng tiếng chuyển thành truyện |
| 16 | `cai-dat` | Cài đặt | `/settings/*` (khoảng 20 trang con) | **Một bài, chia mục, không tách 20 bài:** Giao diện · Chung · Model · Media · Phát âm · Mạng và mirror HF · Hiệu năng · Lưu trữ · Quyền riêng tư · Tài khoản · Cập nhật (Stable/Beta) · Nhật ký · OpenAPI · Chẩn đoán |
| 17 | `khac-phuc-su-co` | Khắc phục sự cố | `/settings/logs`, `/settings/diagnostics`, `/settings/support`, `docs/electron-repair.md` | Đọc nhật ký → chạy chẩn đoán → trợ lý sửa lỗi → báo lỗi qua GitHub (URL điền sẵn) |
| 18 | `video-quang-cao` | Video quảng cáo (Promo) | `/promo`, **chưa merge** | **Bị chặn** cho tới khi nhánh promo vào `main`. Dàn ý sẽ lấy từ code sau khi merge. |
| 19 | `trinh-dung-video` | Trình dựng video | `/editor`, **chưa merge** | **Bị chặn** cho tới khi `feat/video-editor-pro` vào `main`. |

Không viết bài cho `/pro`. Trang này sẽ được nhắc trong bài Bắt đầu nếu cần.

Trang `/tai-lieu` có mục lục chia theo nhóm, khớp các nhóm trong `destinations.ts`:
- **Giọng nói:** bài 2–5
- **Truyện và âm nhạc:** bài 8–10
- **Lồng tiếng:** bài 6–7, 18–19
- **Công cụ khác:** bài 11–14
- **Thư viện và hệ thống:** bài 15–17

Bài 1 đứng đầu.

Quyết định với Promo và Editor: **không** chụp từ nhánh chưa merge. Lý do là UI ở đó còn đổi và tài liệu phải khớp bản người dùng tải về. Hai bài này hiện "Sắp có" trong mục lục cho tới khi nhánh merge.

---

## 2. Chụp ảnh thật: tự động và chụp lại được

### 2.1 Công cụ

Script mới `electron/tests/docs-capture/capture.mjs`, dùng lại `withApp()` của `desktop-harness.mjs`. Script **không** chạy trong CI mặc định; chỉ chạy bằng lệnh riêng `bun run docs:capture`.

Script dùng lại sẵn:
- Playwright `_electron`
- request guard (ảnh chụp không thể kéo dữ liệu từ mạng)
- user-data-dir tạm
- cách theo dõi lỗi console

Cần thêm vào harness, dưới dạng tùy chọn để không ảnh hưởng test hiện có:
- `seed.locale = 'vi'`. Hiện harness cứng `'en'`.
- `seed.theme`: ghi `voicestudio.theme.v2` trước khi trang tải.
- Cửa sổ cố định **1440×900**, `--force-device-scale-factor=1`, đặt kích thước bằng `BrowserWindow.setSize` qua `app.evaluate`. Như vậy DPI của Windows không làm lệch ảnh.
- Tắt animation trước khi chụp: chèn CSS `*{transition:none!important;animation:none!important}` và `caret-color: transparent`.
- Chờ ổn định: `networkidle`, `document.fonts.ready`, và không còn `[aria-busy=true]`.

**Theme:** chụp **theme tối** làm bản chính để hợp với landing (landing chỉ có nền tối). Theme sáng là tùy chọn (`--theme light`). Có thể thêm sau nếu muốn ảnh minh họa phần "đổi theme" trong bài Bắt đầu.

### 2.2 Kịch bản chụp

Mỗi bài có một file kịch bản khai báo `docs-capture/scenarios/<slug>.mjs`:

```js
export default {
  slug: 'nhan-ban-giong',
  fixtures: 'voices-demo',        // bộ dữ liệu mẫu, xem 2.3
  steps: [
    { id: 'mo-trang',   route: '/clone', shot: 'full' },
    { id: 'them-mau',   do: (page) => page.getByRole('button', { name: 'Tải lên' }).click(), shot: { locator: '[data-reference-panel]' } },
    { id: 'tao-audio',  do: ..., shot: 'full', highlight: 'button:has-text("Tạo")' },
  ],
};
```

- Bộ chọn phần tử dùng **accessible name tiếng Việt lấy từ `vi.json`**. Khi UI đổi chữ, kịch bản báo lỗi ngay, không âm thầm chụp sai.
- `highlight` vẽ một khung viền quanh phần tử cần bấm (chèn overlay CSS khi chụp). Nhờ vậy ảnh tự chỉ chỗ bấm, không phải vẽ tay.
- Đầu ra mỗi lần chạy, trong `docs/huong-dan/<slug>/`:
  - `shots/<id>.png`: ảnh gốc, chuyển sang WebP ở bước build
  - `manifest.json`: mỗi bước gồm route, tên file ảnh, kích thước, danh sách **tiêu đề, nút và nhãn đang hiện** (lấy từ cây accessibility), các khóa i18n tìm được, và hash ảnh.

`manifest.json` vừa là ngữ cảnh cho Gemini (mục 3), vừa là cơ sở để phát hiện UI đổi (mục 5).

### 2.3 Trạng thái demo: dùng hai nguồn dữ liệu

| Loại ảnh | Nguồn | Vì sao |
|---|---|---|
| Bố cục, form, các bước thao tác (khoảng 80% số ảnh) | **Backend giả** với bộ fixture mở rộng: `docs-capture/fixtures/*.json` | Ổn định, chạy lại được trên mọi máy, không cần GPU, không có dữ liệu cá nhân. Đây vẫn là app Electron thật đang render; chỉ dữ liệu là mẫu. |
| Trạng thái kết quả (waveform audio vừa tạo, timeline lồng tiếng đã dịch, bài nhạc đã tạo, bản phiên âm) | **Backend thật** (`VOICESTUDIO_SKIP_BACKEND` không bật) với các model đã cài, chạy trên một user-data-dir riêng tên `docs-demo` | Đúng yêu cầu "ảnh thật" ở chỗ người đọc cần thấy kết quả thật. Script đánh dấu các bước này `source: 'live'` và bỏ qua chúng nếu thiếu model. |

Fixture mẫu cần soạn, tất cả là nội dung tự tạo:
- 3–4 giọng mẫu, tên chung như "Giọng Nam Trầm" hay "Giọng Nữ Tin Tức", ảnh đại diện lấy từ bộ chân dung có sẵn của app (`docs/profile-portraits.md`)
- danh sách engine và model ở trạng thái "đã cài"
- 1 dự án lồng tiếng có phân đoạn đã dịch
- 1 truyện ngắn
- lịch sử phiên âm
- 1 quy trình mẫu

Danh sách endpoint cần giả lập có sẵn trong `fake-health-backend.mjs` (`DEFAULT_FIXTURES`).

Media mẫu cho bước live:
- 1 video ngắn khoảng 20 giây có quyền dùng (tự quay, hoặc clip CC0 như Blender Open Movie)
- 1 file giọng mẫu do chính nhóm ghi âm, có đồng ý

Không dùng giọng người nổi tiếng.

Model cần cài trên máy chụp live:
- 1 engine TTS clone (engine mặc định của app)
- ASR (Whisper)
- 1 engine dịch
- ACE-Step cho Music, sau khi PR #16 merge

### 2.4 Không lộ dữ liệu cá nhân

1. **Đường dẫn:** `makeProfile()` tạo thư mục trong `%TEMP%` có tên người dùng. Bản chụp tài liệu sẽ dùng thư mục trung tính (ví dụ `D:\eVoiceDocs\profile`). Fixture `data_dir` và đường dẫn log ghi đè thành `C:\Users\demo\eVoice Studio\data`. Ảnh live dùng user-data-dir `docs-demo` mới tạo, không dùng profile thật của bạn.
2. **Tài khoản:** để tính năng tài khoản ở trạng thái tắt, là mặc định. Không đăng nhập VoiceStudio Cloud và không bật analytics trong ảnh.
3. **Ẩn chỗ còn sót:** Playwright `screenshot({ mask: [...] })` che số phiên bản, đồng hồ, ID máy, các dòng log có đường dẫn, và nhãn token HF ở Cài đặt → Mạng.
4. **Kiểm tra tự động trước khi lưu ảnh:** quét text DOM trong lúc chụp, và OCR ảnh live bằng `tesseract.js` (vie+eng). Kiểm tra fail nếu gặp:
   - tên người dùng Windows (`os.userInfo().username`)
   - email
   - `hf_` + token
   - số điện thoại
   - đường dẫn `C:\Users\<tên thật>`
5. Ảnh do người duyệt xem lại lần cuối (mục 3.5).

---

## 3. Pipeline Gemini

### 3.1 Vị trí và bảo mật

- Script riêng `scripts/docs/generate-guides.ts`, chạy bằng `bun`. Nằm **ngoài app** và ngoài harness có request guard. Đây là công cụ dành cho nhà phát triển. App không gọi Gemini, nên cam kết local-first của app không đổi.
- Thư viện: `@google/genai` ≥ 2.29.1. Không dùng `@google/generative-ai` vì đã ngừng hỗ trợ. Khi bắt đầu viết code phải đọc tài liệu Interactions API như skill yêu cầu.
- API key: đọc từ `process.env.GEMINI_API_KEY`, do bạn tự đặt. Trên Windows dùng PowerShell `[Environment]::SetEnvironmentVariable('GEMINI_API_KEY', '...', 'User')`, không dùng `setx`. Script dừng ngay nếu thiếu key. `.gitignore` thêm `.env*`. Thêm một test nhỏ quét repo, fail nếu thấy chuỗi dạng `AIza…`.
- Mỗi request đặt `store: false`, vì không cần hội thoại nhiều lượt và không muốn lưu nội dung trên server.
- Dùng **key trả phí**. Free tier cho phép Google dùng dữ liệu để cải thiện sản phẩm. Nội dung ở đây không nhạy cảm nhưng vẫn nên tránh.

### 3.2 Chọn model (theo skill `gemini-api-dev`, bảng giá lấy ngày 2026-11-14)

| Vai trò | Model | Lý do |
|---|---|---|
| Viết bài (mặc định) | **`gemini-3.8-flash`** | Đa phương thức, ngữ cảnh 1M token, viết tiếng Việt tốt, rẻ. $0.75 / 1M input, $3.75 / 1M output (output tính cả token suy luận), **giá này áp dụng đến 31/12/2026**, từ 01/01/2027 tăng gấp đôi. |
| Kiểm tra và sửa nhãn | `gemini-3.8-flash`, structured output (JSON) | Trả danh sách nhãn UI được trích trong bài để đối chiếu với `vi.json`. |
| Viết lại cho mượt (tùy chọn) | `gemini-4-argon` | Chỉ dùng cho bài quan trọng như Bắt đầu, Nhân bản, Lồng tiếng nếu bản Flash chưa đạt. $2 / $10 đến 30/11/2026, từ **01/12/2026** tăng lên $4 / $20. |

Batch hoặc Flex giảm 50%. Nên dùng khi sinh lại toàn bộ, vì không cần kết quả ngay.

### 3.3 Đầu vào mỗi bài

1. **System instruction** (dùng chung, khoảng 2k token): văn phong và quy tắc (mục 3.4).
2. **Bảng thuật ngữ** (khoảng 3k token): **sinh tự động** từ `vi.json` và `en.json`. Lấy các khóa của trang liên quan (ví dụ `clone`, `cloneFlow`, `referenceAsr`, `nav`, `common`), thêm tên menu từ `destinations.ts`. Bảng có dạng cặp `en → vi`, không soạn tay, nên luôn khớp bản dịch trong app.
3. **Ngữ cảnh code** (khoảng 15–25k token): file `*-page.tsx` và các component chính của trang (đã bỏ test), cùng tài liệu `docs/*.md` liên quan. Dùng để lấy dữ kiện, không phải để trích dẫn.
4. **Dàn ý** của bài, lấy từ mục 1.
5. **`manifest.json` và ảnh** (6–10 ảnh mỗi bài): đặt `media_resolution: medium`, mỗi ảnh khoảng 560 token. Đủ đọc chữ trên UI ở 1440×900. Bước nào cần chi tiết hơn thì nâng lên `high` (1120 token).

### 3.4 Prompt và văn phong

- Viết như một người hướng dẫn thân thiện. Xưng "bạn", câu ngắn, giọng chủ động. Mỗi bước bắt đầu bằng động từ ("Bấm…", "Kéo…", "Chọn…").
- Tên nút, menu và nhãn **phải giống hệt bản dịch trong app** (bảng thuật ngữ) và đặt trong `**…**`. Không tự dịch lại, không bịa nút.
- Chỉ mô tả những gì có trong ảnh hoặc manifest. Phần nào không chắc thì ghi `<!-- TODO: kiểm tra -->`, không đoán.
- Không có lời quảng cáo sáo rỗng, không có các mẫu câu kiểu AI ("không chỉ… mà còn…", "hãy cùng khám phá").
- Giữ nguyên các thuật ngữ quen thuộc: GPU, model, engine, timeline, hardsub.
- Đầu ra là **Markdown có front-matter** (`title`, `description` ≤ 155 ký tự cho SEO, `slug`, `order`, `updated`, `app_version`). Ảnh chèn bằng `![mô tả alt tiếng Việt](shots/<id>.webp)` với đúng các `id` có trong manifest. Script từ chối bài nếu tham chiếu ảnh không tồn tại.

### 3.5 Kiểm tra tự động và người duyệt

1. **Kiểm tra máy** (`scripts/docs/check-guides.ts`, không tốn API):
   - mọi chuỗi trong `**…**` phải có trong `vi.json` hoặc manifest
   - mọi ảnh được tham chiếu phải tồn tại
   - front-matter đủ trường
   - không còn từ tiếng Anh nằm trong danh sách cấm
   - không chứa đường dẫn hoặc tên người dùng
2. **Người duyệt** (bạn hoặc người được giao):
   - Bản nháp nằm ở `docs/huong-dan/<slug>/index.md` trong repo app, với `status: draft`.
   - Người duyệt sửa trực tiếp và đổi thành `status: approved`.
   - Chỉ bài `approved` mới được đồng bộ sang landing.
   - Bài đã duyệt mà bị sinh lại sẽ lưu thành `index.next.md` kèm diff, **không ghi đè** bản đã sửa tay.
3. **Xem trước:** đồng bộ sang landing trên **một nhánh riêng**. Vercel tạo URL preview. Bạn xem bản preview rồi đồng ý merge vào `main`; chỉ khi merge mới lên site thật.

---

## 4. Cấu trúc `/tai-lieu` trên landing

### 4.1 Cây file (repo `evoice-landing`)

```
index.html                     ← thêm mục menu "Tài liệu"
tai-lieu/index.html            ← mục lục
tai-lieu/<slug>/index.html     ← mỗi bài một trang
tai-lieu/img/<slug>/<id>.webp
tai-lieu/search-index.json     ← chỉ mục tìm kiếm nhỏ
assets/site.css                ← (tùy chọn, xem 4.2)
scripts/build-docs.mjs         ← Markdown → HTML theo template
vercel.json                    ← trailingSlash, cache header cho ảnh
```

Dùng `tai-lieu/<slug>/index.html` để URL gọn (`/tai-lieu/nhan-ban-giong/`) mà không phụ thuộc rewrite.

### 4.2 Giữ đúng phong cách landing

Landing là một file có CSS inline: token `--canvas`, `--fg`, `--silver`, font Space Grotesk, Inter và JetBrains Mono, bo góc 8/12/20 px, nền tối, không màu nhấn. Có hai cách:

- **A (khuyên dùng):** `build-docs.mjs` đọc `index.html`, **trích** khối `:root` và token, phần CSS của `.nav`/`.btn`/`footer`, cùng HTML của header, footer và sprite SVG. Script ghép chúng vào template tài liệu. Không cần sửa cấu trúc landing; style luôn đồng bộ mỗi khi build.
- B: tách CSS dùng chung ra `assets/site.css` và cho cả hai trang link tới. Gọn hơn về lâu dài nhưng **phải sửa landing đang chạy**, nên cần bạn duyệt riêng.

Template trang bài:
- Header giống landing. Các anchor đổi thành `/#gioi-thieu`, `/#tinh-nang`…; mục "Tài liệu" ở trạng thái active.
- Bố cục hai cột ở desktop: mục lục nhóm bên trái (sticky), nội dung tối đa khoảng 720 px.
- Ở điện thoại còn một cột, mục lục thu vào nút.
- Ảnh có viền `--line` và bo góc `--r-card`. Bấm vào ảnh thì phóng to (lightbox nhỏ, không thêm thư viện).
- Có "Bài trước / Bài sau", "Cập nhật ngày …, phiên bản app …", và nút "Báo sai sót" mở GitHub Issue điền sẵn. Không dùng form thu dữ liệu.
- Không dùng animation intro của landing, để trang tài liệu tải nhanh.

### 4.3 Menu header và ngôn ngữ

- Thêm `<a href="/tai-lieu/" data-i18n="tXXX">Tài liệu</a>` vào `nav.nav-links` của `index.html`, đặt sau "Tính năng". Thêm khóa mới vào từ điển song ngữ: `vi: "Tài liệu"`, `en: "Docs"`.
- Kiểm tra lại breakpoint ở 420 px; menu thêm một mục có thể bị tràn.
- Trên `/tai-lieu`, tài liệu chỉ có tiếng Việt. Nút đổi ngôn ngữ sẽ **ẩn**, kèm một dòng nhỏ "Tài liệu hiện có tiếng Việt". Không làm bản tiếng Anh lúc này.

### 4.4 Tìm kiếm

Với khoảng 17–19 bài, **có làm, nhưng ở mức tối giản**:
- Lúc build, sinh `search-index.json` gồm tiêu đề, mô tả, các tiêu đề con và vài từ khóa mỗi bài (khoảng 20–30 KB).
- Ô tìm ở trang mục lục và thanh bên lọc phía client, bỏ dấu tiếng Việt khi so khớp (NFD).
- Không dùng Pagefind hay Algolia vì quá sức cần thiết, và không thêm request ra bên thứ ba.

### 4.5 SEO và og

- Mỗi trang có `<title>{Bài} · Tài liệu eVoice Studio</title>`, `meta description` lấy từ front-matter, `link rel=canonical` dạng URL tuyệt đối, `html lang="vi"`.
- `og:title`, `og:description`, `og:url` tuyệt đối. `og:image` lấy ảnh đầu tiên của bài, cắt 1200×630 lúc build, đường dẫn tuyệt đối để Facebook và Zalo hiển thị được. Có `twitter:card=summary_large_image`.
- JSON-LD: `TechArticle` cho mỗi bài, `BreadcrumbList` (Trang chủ › Tài liệu › Bài).
- Có `sitemap.xml` (landing chưa có) và `robots.txt`.
- Ảnh WebP chất lượng khoảng 82, có `width`/`height` để tránh nhảy bố cục, `loading="lazy"` trừ ảnh đầu. Ngân sách: ảnh ≤ 180 KB, tổng ảnh mỗi trang ≤ 1.5 MB.

---

## 5. Cập nhật lại khi UI đổi

Quy trình một lệnh: `bun run docs:refresh`.

1. `docs:capture` chạy toàn bộ kịch bản. Bước nào hỏng (không tìm thấy nút, route đổi) thì báo lỗi rõ ràng và dừng ở bài đó.
2. **So sánh với lần chụp trước:**
   - Pixel diff bằng `pixelmatch`, ngưỡng khoảng 1%.
   - Diff danh sách nhãn trong `manifest.json`.
   - Kết quả ghi vào `docs/huong-dan/CHANGES.md`: bài nào đổi ảnh, bài nào đổi nhãn.
3. **Chỉ sinh lại bài có nhãn hoặc bố cục đổi** (`generate-guides --changed`). Bài chỉ đổi ảnh nhẹ thì thay ảnh, giữ chữ.
4. Bài đã duyệt mà bị sinh lại thành `index.next.md` (mục 3.5) để người duyệt gộp phần thay đổi.
5. Đồng bộ sang landing trên nhánh mới → xem preview → bạn duyệt → merge.

Tùy chọn sau này: một job CI hằng tuần chỉ chạy bước 1–2 (không gọi Gemini) và mở issue "Tài liệu lệch UI" khi có diff.

---

## 6. Chi phí, rủi ro, thứ tự

### 6.1 Ước tính token và chi phí (`gemini-3.8-flash`, giá đến 31/12/2026)

Mỗi bài:

| Phần | Token |
|---|---|
| System instruction + bảng thuật ngữ | ~5k |
| Code và docs | ~20k |
| Dàn ý + manifest | ~3k |
| 8 ảnh × 560 | ~4.5k |
| **Input** | **~33k** |
| Bài viết khoảng 1.500–2.500 chữ | ~4k |
| Token suy luận | ~8k |
| **Output** | **~12k** |

Một lượt cho 17 bài, chưa tính hai bài bị chặn:
- Input: 17 × 33k ≈ 560k token × $0.75/1M ≈ **$0.42**
- Output: 17 × 12k ≈ 204k token × $3.75/1M ≈ **$0.77**
- Cộng **≈ $1.2 cho mỗi lần sinh toàn bộ**.
- Bước kiểm tra nhãn bằng structured output tốn thêm khoảng $0.2.

Dự trù cả dự án: khoảng 3–4 vòng thử prompt và sinh lại, cộng vài lượt cập nhật → **≈ $5–8**.

Nếu viết lại 3 bài chính bằng `gemini-4-argon` sau 01/12/2026: 3 × (40k × $4 + 12k × $20)/1M ≈ **$1.2 mỗi lượt**.

Batch hoặc Flex giảm thêm 50%. Sau 01/01/2027 giá Flash tăng gấp đôi nhưng vẫn dưới khoảng $3 cho mỗi lượt sinh toàn bộ.

Chi phí không phải tiền API:
- Thời gian chạy backend thật để chụp ảnh live, cần máy có GPU.
- Thời gian người duyệt: khoảng 15–20 phút mỗi bài.

### 6.2 Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| UI đang đổi: logo trắng, menu bar mới, Music Studio, PR #16 | Chụp ảnh **sau** khi các thay đổi đó merge (cổng ở Pha 2). Làm hạ tầng trước. |
| Gemini bịa nút hoặc bước | Bảng thuật ngữ sinh từ `vi.json`, manifest nhãn, script kiểm tra nhãn, người duyệt. |
| Lộ tên người dùng hoặc đường dẫn trong ảnh | Thư mục trung tính, mask, kiểm tra DOM và OCR, người duyệt. |
| Ảnh live không lặp lại được (kết quả model khác nhau mỗi lần) | Chỉ khoảng 20% ảnh là live. Cố định seed sinh nếu engine hỗ trợ. Không pixel-diff ảnh live, chỉ diff manifest. |
| Bản dịch `vi.json` còn câu dịch máy cứng nhắc | Ghi các nhãn khó hiểu vào `docs/huong-dan/i18n-issues.md` để sửa trong app, không "sửa" trong bài, vì bài phải khớp app. |
| Promo và Editor chưa merge | Hiện "Sắp có", viết khi nhánh vào `main`. |
| Push landing là tự deploy | Luôn làm qua nhánh, preview URL, rồi bạn duyệt trước khi merge. |
| Sửa landing làm hỏng trang chủ | Phương án A không đổi cấu trúc landing; chỉ thêm một mục menu và một khóa i18n. |
| Giá Gemini tăng (argon từ 01/12, flash từ 01/01/2027) | Chi phí vẫn nhỏ. Ưu tiên sinh lượt chính trước 31/12 nếu tiện. |
| Font Google và jsDelivr làm chậm trang tài liệu | Dùng chung font với landing. Không tải Motion trên trang tài liệu. |

### 6.3 Thứ tự các pha

| Pha | Nội dung | Phụ thuộc | Cần bạn duyệt |
|---|---|---|---|
| **1. Hạ tầng chụp** | Tùy chọn locale, theme và cửa sổ cố định trong harness · `docs-capture/` · bộ fixture mẫu · kiểm tra dữ liệu cá nhân · thử với 2 bài (Nhân bản, Lồng tiếng) | Có thể bắt đầu ngay; ảnh lúc này chỉ để thử | PR vào repo app |
| **2. Cổng UI ổn định** | Chờ merge: logo trắng · menu bar · PR #16 (logo, Support, ACE-Step) · Music Studio (nếu kịp; nếu không, viết bài Music sau) | Các phiên song song | Bạn xác nhận "UI đã ổn" |
| **3. Chụp toàn bộ** | Chụp bằng fixture cho 17 bài · chụp live trên máy có model · người duyệt xem ảnh | Pha 1, 2 | Duyệt ảnh |
| **4. Pipeline Gemini** | `generate-guides.ts` + `check-guides.ts` · chạy thử 2 bài, chỉnh prompt · sinh 17 bài | Pha 3, `GEMINI_API_KEY` | **Đồng ý chi tiền API** (≈ $1–2 mỗi lượt) |
| **5. Duyệt nội dung** | Sửa tay, đổi `status: approved` | Pha 4 | Bạn |
| **6. Trang `/tai-lieu`** | `build-docs.mjs`, template, tìm kiếm, SEO, sitemap · mục menu "Tài liệu" · nhánh trên `evoice-landing` và preview Vercel. Có thể làm template song song từ Pha 1 với dữ liệu giả. | Pha 5 | **Đồng ý push và merge** (merge là deploy) |
| **7. Bảo trì** | `docs:refresh` · Promo và Editor khi merge · (tùy chọn) CI kiểm tra lệch UI hằng tuần | — | Mỗi lần đăng |

Sửa luôn khi làm Pha 6 nếu chưa có ai sửa: nút tải trên landing còn trỏ tới `labs.elevatemarketing.vn`, là địa chỉ không tồn tại. Trang tài liệu (bài Bắt đầu) sẽ dẫn về nút tải đó, nên cần một URL tải thật, ví dụ GitHub Releases của `eVoice-Studio`.

---

## 7. Việc cần bạn quyết định

1. Theme ảnh: chỉ tối (khuyên dùng), hay cả sáng?
2. Nguồn media mẫu cho ảnh live: clip CC0 hay video tự quay; giọng mẫu do ai ghi?
3. Cách giữ style: phương án A (trích từ `index.html`, khuyên dùng) hay B (tách `assets/site.css`)?
4. Tài liệu Markdown đặt ở repo app (`docs/huong-dan/`, khuyên dùng để đi cùng code) hay chỉ ở repo landing?
5. URL tải thật để thay `labs.elevatemarketing.vn`.
