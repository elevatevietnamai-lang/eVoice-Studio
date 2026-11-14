# Tài liệu hướng dẫn tiếng Việt (`/tai-lieu`)

Mỗi thư mục `docs/huong-dan/<slug>/` là một bài hướng dẫn cho người dùng eVoice Studio:

- `index.md` — bài viết, front-matter có `status: draft` (bản nháp) hoặc `status: approved` (đã duyệt).
- `shots/<id>.png` — ảnh chụp app thật, 1440×900, theme tối, giao diện tiếng Việt.
- `manifest.json` — route, file, hash và danh sách tiêu đề, nút, nhãn đang hiện của từng ảnh.

Danh sách bài, nhóm và dàn ý nằm trong `scripts/docs/guides.py`. Kế hoạch đầy đủ: `PLAN-docs-tai-lieu.md`.

## Quy trình

1. **Chụp ảnh** (cần đã build Electron: `bun run --cwd electron build`):

   ```bash
   bun run docs:capture                 # mọi bài
   bun run docs:capture nhan-ban-giong  # một bài
   ```

   Kịch bản chụp ở `electron/tests/docs-capture/scenarios/<slug>.mjs`. App chạy qua harness test với backend giả
   và dữ liệu mẫu (`fixtures.mjs`), chặn mọi request ra ngoài máy, và dừng nếu text trên trang có tên người dùng
   hệ điều hành, email, token `hf_`, số điện thoại hoặc đường dẫn `C:\Users\<tên>`. Bộ chọn phần tử lấy chữ từ
   `vi.json`, nên khi giao diện đổi chữ thì kịch bản báo lỗi thay vì chụp sai.

2. **Viết nháp bằng Gemini 4 Argon qua `agy` CLI**:

   ```bash
   bun run docs:generate                      # mọi bài đã có ảnh
   bun run docs:generate -- cai-dat --jobs 2  # một bài
   ```

   Script tạo brief trong `.docs-staging/` (quy tắc văn phong, bảng thuật ngữ sinh từ `en.json`/`vi.json`, dàn ý,
   manifest), rồi chạy `agy --mode plan` (chỉ đọc) để model xem ảnh, tài liệu và code rồi in bài. Bài không qua
   bước kiểm tra sẽ được viết lại một lần kèm danh sách lỗi. Bài đã `approved` không bị ghi đè: bản mới lưu thành
   `index.next.md` để người duyệt gộp.

3. **Kiểm tra**: `bun run docs:check` (cũng chạy trong `tests/test_user_guides.py`). Kiểm tra front-matter, ảnh
   tồn tại, mọi chữ in đậm phải là nhãn có trong `vi.json` hoặc manifest, liên kết tới bài có thật, không có dữ
   liệu cá nhân, và đếm các ghi chú `<!-- TODO: kiểm tra -->`.

4. **Duyệt**: người duyệt đọc bài cùng ảnh, sửa trực tiếp, xử lý các TODO rồi đổi `status: approved`.

5. **Đăng**: repo landing (`evoice-landing`) chạy
   `node scripts/build-docs.mjs <repo-app>/docs/huong-dan` để sinh `tai-lieu/`. Mặc định chỉ build bài đã duyệt;
   `--include-drafts` build cả bản nháp (có nhãn "Bản nháp", `noindex`) để xem trên nhánh preview.

Ảnh chụp dùng dữ liệu mẫu nên không có ảnh kết quả thật (waveform vừa tạo, timeline đã dịch). Phần chụp "live" với
model thật chưa làm.
