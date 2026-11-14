# Kế hoạch: Music Studio — cài đặt nâng cao (tham chiếu ace-step-ui)

Ngày khảo sát: 2026-11-14. Chỉ là kế hoạch, chưa sửa code.

**Code gốc để so sánh:** nhánh `chore/evoice-batch` (chưa merge), vì nhánh worktree này chưa có bản sửa trang Music mới nhất.
- Backend: `backend/services/music.py` (engine, `MusicRequest`, `build_payload`), `backend/api/routers/music.py` (`GenerateBody`, SSE), `backend/services/bgm.py` (BGM cho dub, cũng tạo `MusicRequest`), `backend/services/music_library.py`.
- UI: `electron/src/renderer/src/features/music/music-page.tsx` (+ `music-page.test.tsx`).
- Test: `tests/test_music_service.py`. Tài liệu: `docs/music-studio.md`.

**Nguồn tham chiếu:**
- `fspecii/ace-step-ui` (HEAD ngày 2026-11-14, push gần nhất 2026-06-27): `types.ts` (`GenerationParams`), `components/CreatePanel.tsx`, `server/src/services/acestep.ts`.
- Hợp đồng thật mà backend gọi: `GenerateMusicRequest` trong `acestep/api/http/release_task_models.py` và `.claude/skills/acestep-docs/api/API.md` của `ace-step/ACE-Step-1.5` @ `ca1e85fe9430179831e6bc6be790c332190a3866` (đúng revision đang pin trong `ACESTEP_REVISION`; giấy phép MIT).

---

## 0. Giấy phép: chỉ tái dùng ý tưởng, không chép code

| Hạng mục | Kết quả kiểm tra (2026-11-14) | Hệ quả |
|---|---|---|
| `fspecii/ace-step-ui` | GitHub API trả `license: null`. Cây repo **không có** file `LICENSE`/`COPYING`. `package.json` không có trường `license`. README có huy hiệu "MIT" và link tới `LICENSE`, nhưng file đó không tồn tại. | Coi như **chưa có giấy phép**: không chép code, không chép CSS và không chép danh sách tag trong `data/all_style.txt`/`main_style.txt`/`genres.ts`. Chỉ tham khảo tên tính năng và cách bố trí ở mức ý tưởng, và tự viết lại. Muốn tái dùng code thì phải nhờ tác giả thêm file LICENSE trước. |
| Các phần ace-step-ui đóng gói kèm (AudioMass, demucs-web, wavesurfer) | Mỗi phần có giấy phép riêng | Ngoài phạm vi kế hoạch này. |
| `ace-step/ACE-Step-1.5` | MIT | Tên tham số, giá trị mặc định và ngữ nghĩa lấy từ đây. Đây là nguồn chuẩn. |
| Model `ACE-Step/acestep-v15-sft`, `-base`, `acestep-5Hz-lm-0.6B` (chỉ dùng nếu làm Pha 3) | Chưa kiểm tra | Trước khi thêm, phải pin revision và ghi giấy phép kèm bằng chứng vào `backend/config/model_licenses.json` và `docs/licensing/model-license-data.json`. |

Không dùng được kỹ thuật của ace-step-ui: nó gọi Gradio `/generation_wrapper` bằng 50 tham số theo vị trí, còn ta gọi REST `/release_task` bằng JSON có tên trường.

**Loại bỏ vì vi phạm local-first:** `services/geminiService.ts` ("AI Enhance" qua Gemini cloud), Video Generator dùng Pexels, đăng nhập/chia sẻ/LAN/like/playlist công khai. Bản thay thế cục bộ cho "Enhance" là LM 5Hz của chính ACE-Step (`/format_input` hoặc `use_cot_caption`).

---

## 1. Hiện trạng và nguyên nhân chất lượng kém

`build_payload()` hiện gửi:

```
model: (mặc định = acestep-v15-turbo)  inference_steps: 8  batch_size: 1
thinking / use_cot_caption / use_cot_language / use_format: false
ACESTEP_INIT_LLM=false (không nạp LM khi khởi động server)
```

UI chỉ cho nhập: mô tả, công tắc "không lời", lời bài hát, độ dài (10–240 giây), BPM. Backend đã nhận `key_scale`, `seed` và `vocal_language`, nhưng UI không hiện các ô này.

Ba nguyên nhân chính:
1. **LM 5Hz đã có trên đĩa nhưng không dùng.** Bộ cài tải `ACE-Step/Ace-Step1.5` @ `19671f4…`, gồm `acestep-v15-turbo`, `acestep-5Hz-lm-1.7B`, `vae` và `Qwen3-Embedding-0.6B`. Server lại chạy với `ACESTEP_INIT_LLM=false`, và mọi yêu cầu đều gửi `thinking=false`. Theo API.md, với `thinking=true` thì "DiT runs with LM-generated codes for enhanced music quality". Đây là chế độ cho chất lượng tốt nhất, nhất là bài có lời: bố cục bài, nhạc khớp với lời, BPM/key/độ dài được tự điền.
2. **Thiếu metadata âm nhạc trong UI:** key, nhịp (time signature) và ngôn ngữ giọng hát không được truyền. Với bài có lời, sai ngôn ngữ làm phát âm hỏng. Hiện vẫn cứng `en`, kể cả khi người dùng viết lời tiếng Việt.
3. **Không có biến thể hay seed:** mỗi lần chỉ ra 1 bản và không giữ lại seed, nên không thể "sinh 4 bản rồi chọn bản hay" hay tinh chỉnh quanh một bản ưng ý.

**Lưu ý quan trọng về turbo** (API.md): `guidance_scale`, `shift`, `use_adg` và `cfg_interval_*` **chỉ có tác dụng với model base/SFT**. Turbo đã chưng cất CFG, nên `inference_steps` chỉ nên trong 1–20 (khuyến nghị 8). Vì vậy **không** làm các thanh trượt CFG/shift khi đang dùng turbo: chúng không đổi được gì. Các mặc định của ace-step-ui (guidance 9, steps 12) không áp dụng cho ta. Để `dcw_enabled` không đặt, cho model tự quyết.

---

## 2. Bảng tính năng: ace-step-ui ↔ eVoice Music Studio

Cột "API" = trường của `/release_task` tại revision đang pin. Ưu tiên P1 = cải thiện chất lượng nhiều nhất; P4 = để sau cùng / không làm.

| Tính năng (ace-step-ui) | Trường API ACE-Step | eVoice hiện có? | Hiệu lực trên turbo | Ưu tiên |
|---|---|---|---|---|
| Thinking mode (LM sinh audio codes) | `thinking`, cần LM đã nạp | ❌ (luôn tắt) | ✅ | **P1** |
| Ngôn ngữ giọng hát | `vocal_language` | backend ✅ (cứng `en`), UI ❌ | ✅ | **P1** |
| Key / scale | `key_scale` | backend ✅, UI ❌ | ✅ | **P1** |
| Nhịp (time signature) | `time_signature` | ❌ | ✅ | **P1** |
| BPM | `bpm` | ✅ | ✅ | có |
| Độ dài | `audio_duration` (10–600 giây) | ✅ (10–240 giây) | ✅ | giữ 240, cân nhắc nới sau |
| Độ dài/BPM/key "Tự động" (LM điền) | để trống + `use_cot_*` | ❌ | ✅ (cần LM) | **P1** (đi cùng LM) |
| Seed cố định / ngẫu nhiên, lưu seed vào thư viện | `use_random_seed`, `seed` | backend ✅, UI ❌, không lưu seed thực tế | ✅ | **P1** |
| Batch (nhiều biến thể một lần) | `batch_size` (≤ 8) | ❌ (cứng 1) | ✅ | **P2** |
| Inference steps | `inference_steps` | ❌ (cứng 8) | ✅ (1–20) | **P2** |
| Phương pháp suy luận ODE/SDE | `infer_method` | ❌ | ✅ | **P2** |
| Định dạng đầu ra | `audio_format` (wav/flac/mp3/opus…) | backend ✅ (wav), UI ❌ | ✅ | **P2** |
| Lyrics editor có thẻ cấu trúc `[verse]` `[chorus]` `[bridge]` | (văn bản trong `lyrics`) | ❌ | ✅ | **P2** (rẻ, giúp nhiều) |
| Gợi ý style/genre (tag chip) | (văn bản trong `prompt`) | 5 preset cố định | ✅ | **P2** (tự viết danh sách, không chép) |
| "Enhance"/Format caption + lời | `/format_input`, `use_cot_caption` | ❌ | ✅ (cần LM) | **P2** |
| Dùng lại thiết lập từ bản cũ | — (UI) | ❌ | ✅ | **P2** |
| Tham số LM (temperature, cfg, top-k/p, negative) | `lm_*` | ❌ | ✅ | **P3** (ẩn trong "Chuyên gia") |
| Audio tham chiếu (style reference) | `reference_audio_path` | ❌ | ✅ | **P3** |
| Cover / Remix từ bài có sẵn | `task_type=cover`, `src_audio_path`, `audio_cover_strength` | ❌ | ✅ | **P3** |
| Repaint một đoạn | `task_type=repaint`, `repainting_start/end`, `repaint_mode`, `repaint_strength` | ❌ | ✅ | **P3** |
| Extend (kéo dài) | các lần repaint nối tiếp (Tutorial §"Infinite duration") | ❌ | ✅ | **P3** (làm sau repaint) |
| Chọn DiT model (turbo/SFT/base) | `model`, `ACESTEP_CONFIG_PATH2/3` | ❌ (chỉ turbo) | — | **P3** (cần tải thêm) |
| Guidance/CFG, shift, ADG, CFG interval, custom timesteps | `guidance_scale`, `shift`, `use_adg`, `cfg_interval_*`, `timesteps` | ❌ | ❌ chỉ base/SFT | **P3** (chỉ hiện khi chọn base/SFT) |
| Extract stem / Lego / Complete | `task_type=extract/lego/complete` | ❌ | ❌ chỉ base | **P4** |
| LoRA load/scale | `/v1/lora/load`, `/v1/lora/scale` (0..1) | ❌ | ✅ | **P4** |
| Training LoRA | — | ❌ | — | **P4 / không làm** |
| Auto score, LRC (lời có mốc thời gian) | `get_scores`, `get_lrc` (trên Gradio) | ❌ | ? | **P4** (kiểm tra API REST trước) |
| AudioMass editor, Demucs stem, Video generator, playlist, LAN, chia sẻ | — | ❌ | — | **không làm** (ngoài phạm vi hoặc vi phạm local-first) |

---

## 3. Lộ trình theo pha

> **Trạng thái 2026-11-14:** Pha 1 đã làm xong trên nhánh `feat/music-advanced` (tách từ `chore/evoice-batch`), chưa commit. Phần làm thật khác bản kế hoạch dưới đây ở mấy điểm:
> - **LM 0.6B được đưa lên Pha 1.** GPU 12 GB (ví dụ RTX 3060) thuộc tier4 của ACE-Step, tức chỉ chạy được 0.6B. Model này là bản tải tùy chọn có pin revision `148d8ea…` (MIT, khoảng 1,4 GB), qua `GET /music/lm-install-stream`.
> - **Không có công tắc "Tự động metadata" riêng.** Thinking bật thì LM tự điền BPM, key và nhịp đang để Auto. `use_cot_caption`/`use_cot_language` vẫn tắt, nên mô tả và ngôn ngữ giữ nguyên như người dùng viết.
> - **Trạng thái LM** lấy qua endpoint riêng `GET /music/lm`, không gộp vào `/music/status`, vì việc đo GPU phải chạy Python của engine.
> - **Chế độ server luôn khớp từng yêu cầu.** Khi đã nạp LM, ACE-Step cũng điền metadata cho cả những yêu cầu không bật Thinking. Vì vậy bật/tắt Thinking sẽ khởi động lại server, và server không bao giờ đổi chế độ khi đang có bài chạy.
> - **Chặn tải model ngầm:** server chạy với `HF_HUB_OFFLINE=1` + `ACESTEP_DOWNLOAD_SOURCE=huggingface`, và bỏ các biến `MAX_*_VRAM`. Sau khi khởi động, log phải ghi đúng model đã nạp; nếu không thì dừng server và báo lỗi.

### Pha 1 — Chất lượng (P1): bật LM và metadata đầy đủ

**Backend (`services/music.py`)**
- `MusicRequest` thêm các trường sau. Mặc định nào cũng phải tái tạo **đúng byte-cho-byte** payload hiện tại, để `bgm.py` không đổi hành vi:
  - `time_signature: str = ""`
  - `thinking: bool = False`
  - `auto_metadata: bool = False`: khi bật thì ánh xạ sang `use_cot_caption`/`use_cot_language` và để trống bpm/key/duration cho LM điền.
- `build_payload()`: chỉ gửi `thinking`/`use_cot_*` = true khi yêu cầu chọn bật, và luôn gửi `lm_backend` tường minh. Mặc định của server là `vllm`, không chạy trên Windows/macOS.
- **Vòng đời server có LM:**
  - Thêm chế độ khởi động `with_llm`: `ACESTEP_INIT_LLM=true`, `ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B`, và `ACESTEP_LM_BACKEND` theo nền tảng (`pt` cho CUDA/CPU; `mlx` hoặc `pt` trên Apple Silicon — **cần kiểm chứng trên Mac ở revision pin trước khi chọn**).
  - Yêu cầu cần LM mà server đang chạy không LM → dừng rồi khởi động lại với LM. Server được giữ theo dạng `_Server`; thêm cờ `llm` vào đó.
  - Ngược lại thì giữ nguyên server đang chạy. Server có LM vẫn phục vụ được yêu cầu không LM.
- **Kiểm tra VRAM trước khi bật LM.** Theo `gpu_config.py` @ pin: LM 1.7B cần khoảng 3.4 GB weights + KV cache, và chỉ được bật từ tier5 (12–16 GB) trở lên; tier3–4 (6–12 GB) chỉ được 0.6B.
  - Đủ VRAM → chạy.
  - Không đủ → trả lỗi SSE có mã `music_llm_vram`, kèm thông điệp rõ ràng ("cần ≈12 GB VRAM; tắt Thinking hoặc chọn LM 0.6B ở Pha 3").
  - **Không** tự âm thầm tắt LM: người dùng phải biết vì sao kết quả khác đi.
  - Dùng lại helper đo VRAM đã có trong `backend/core`/`services` nếu có. Nếu chưa có thì viết một hàm nhỏ có test.
- `/music/status` trả thêm `llm_available` (LM có trên đĩa), `llm_supported` (đủ VRAM) và `llm_running`, để UI bật hoặc tắt công tắc.

**Router (`api/routers/music.py`)**
- `GenerateBody` thêm:
  - `time_signature: Literal["", "2", "3", "4", "6"] = ""`
  - `thinking: bool = False`
  - `auto_metadata: bool = False`
- Giới hạn `vocal_language` theo danh sách ngôn ngữ ACE-Step hỗ trợ (lấy từ `acestep/constants.py` @ pin), cộng `"unknown"` cho nhạc không lời.
- Lưu vào thư viện **seed thực tế** server đã dùng (kết quả có trường seed) cùng toàn bộ tham số, để chức năng "dùng lại thiết lập" hoạt động. Thêm khóa `params` vào record của `music_library`, có mặc định khi đọc record cũ (tương thích ngược, không cần migration).

**UI (`music-page.tsx`)**
- Ngay dưới ô lời: **Ngôn ngữ giọng hát** (`Select`, tự chọn theo ngôn ngữ của app). Ô này ẩn khi bật "không lời".
- Nhóm "Âm nhạc": BPM (đã có), **Key** (`Select`: Tự động + 24 key), **Nhịp** (`ToggleGroup`: Tự động / 2/4 / 3/4 / 4/4 / 6/8), **Seed** (`Input` + nút xúc xắc + công tắc "Cố định").
- Công tắc **"Chất lượng cao (Thinking)"**, tắt mặc định:
  - Khi `llm_supported=false`: công tắc bị vô hiệu và hiện tooltip giải thích.
  - Khi bật: hiện ghi chú "lần đầu nạp LM sẽ lâu hơn".
- Công tắc **"Tự động BPM/key/độ dài"** chỉ bật được khi Thinking bật.

**Chính sách đa nền tảng:** Thinking là **tùy chọn người dùng tự bật** (opt-in), không phải mặc định. Vì vậy hành vi mặc định vẫn giống nhau trên mọi hệ điều hành. Nếu `pt` LM chạy được trên CPU/MPS nhưng chậm, đó là khác biệt hiệu năng, được CLAUDE.md cho phép. Nếu LM **không chạy được** trên một nền tảng ở revision pin, thì nền tảng đó phải hiện công tắc bị vô hiệu kèm lý do. Trước khi merge phải kiểm chứng trên Windows CUDA, Linux CUDA, macOS MPS và CPU.

### Pha 2 — Biến thể và kiểm soát (P2)

- **Batch 1–4:** `GenerateBody.batch_size: int = Field(1, ge=1, le=4)`. Server cho tối đa 8; ta giới hạn 4 vì VRAM và thời gian chạy.
  - Router kiểm tra `music_library` còn đủ `batch_size` chỗ **trước** khi chạy.
  - Engine tải về **mọi** file kết quả. Hiện `generate()` chỉ lấy 1 file; cần chỉnh chỗ parse `query_result`.
  - Lưu N record; SSE gửi `track` cho từng bản rồi `done` với danh sách.
  - UI hiện các bản dưới dạng nhóm để so sánh.
- **Inference steps** (`Slider` 4–20, mặc định 8) và **ODE/SDE** (`ToggleGroup`): đặt trong panel "Nâng cao".
- **Định dạng đầu ra** (WAV/FLAC/MP3): `music_library` đã có trường `ext`. Cần sửa `music_audio()` để trả đúng `media_type` theo ext (hiện cứng `audio/wav`).
- **Trình soạn lời:** thanh chèn nhanh các thẻ `[intro] [verse] [pre-chorus] [chorus] [bridge] [outro] [instrumental]`, kèm gợi ý ngắn lấy theo Tutorial của ACE-Step (viết lại bằng lời của ta, qua i18n).
- **Chip style:** khoảng 30 tag thể loại/nhạc cụ/tâm trạng do ta tự soạn, bấm để nối vào mô tả. Danh sách nằm trong code, còn nhãn hiển thị đi qua `t()`.
- **Format/Enhance cục bộ:** `POST /music/format` gọi `/format_input` của server (cần LM). Trả caption, lời, bpm, key và độ dài đã chuẩn hóa để người dùng **xem rồi mới áp dụng**.
- **"Dùng lại thiết lập"** trong menu của từng bài trong thư viện: nạp `params` vào form.

### Pha 3 — Biên tập từ audio và model khác (P3)

- **Nguồn audio an toàn:** `src_audio_path`/`reference_audio_path` phải là đường dẫn tuyệt đối trên máy chủ. Chỉ nhận `source_track_id` (bài trong thư viện) hoặc `upload_id` (file người dùng tải lên qua endpoint mới, lưu dưới `DATA_DIR/music/uploads`, giới hạn kích thước và định dạng, kiểm tra bằng ffprobe). **Tuyệt đối không** nhận đường dẫn từ client. Backend tự resolve, và có test chống path traversal.
- **Cover/Remix:** `task_type=cover` + `audio_cover_strength` (0–1; 0.2 cho chuyển phong cách nhẹ) + `cover_noise_strength`.
- **Repaint:** chọn vùng trên `WaveformPlayer` (start/end), `repaint_mode` (conservative/balanced/aggressive), `repaint_strength`. Kết quả lưu thành bài mới; không ghi đè bài gốc.
- **Extend:** repaint vùng nằm sau đuôi bài, theo hướng dẫn "Infinite duration" của ACE-Step. **Cần thử trên revision pin** xem đặt `audio_duration` > độ dài nguồn cùng `repainting_start` = độ dài nguồn có hoạt động không, rồi mới thiết kế UI.
- **Audio tham chiếu phong cách:** `reference_audio_path`.
- **Model DiT bổ sung (tải tùy chọn):** `acestep-v15-sft` / `acestep-v15-base`, và `acestep-5Hz-lm-0.6B` cho máy 6–12 GB.
  - Mỗi model: pin revision, ghi giấy phép kèm bằng chứng, ước tính dung lượng, cài từng model qua SSE giống bộ cài hiện tại.
  - Truyền qua `ACESTEP_CONFIG_PATH2` + trường `model`.
  - Khi đang chọn base/SFT, panel mới hiện **Guidance (CFG)**, **Shift**, **ADG**, **CFG interval**, và steps mở rộng tới 64.
  - UI ẩn mọi nút không có tác dụng với model đang chọn. Danh sách "nút nào hợp lệ cho model nào" nằm trong một bảng duy nhất, dùng chung cho backend validate và UI.

### Pha 4 — Để sau / có thể không làm

- LoRA: `/v1/lora/load` nhận đường dẫn do người dùng chọn, nên bắt buộc `require_admin` + `require_desktop`, chỉ chọn qua hộp thoại file của Electron; scale trong 0..1.
- Extract/Lego/Complete (chỉ chạy trên base).
- Auto score / LRC: kiểm tra trước xem API REST tại revision pin có hỗ trợ không.
- Training LoRA: không làm trong Music Studio.

---

## 4. UI: panel "Nâng cao" theo `DESIGN.md`

- Bố cục cột điều khiển:
  1. **Cơ bản**: mô tả + chip style, không lời, lời + thanh thẻ cấu trúc, ngôn ngữ giọng.
  2. **Âm nhạc**: độ dài, BPM, key, nhịp.
  3. **Chất lượng**: Thinking, tự động metadata, số biến thể.
  4. **Nâng cao**: seed, steps, ODE/SDE, định dạng, và các nút chỉ dành cho base/SFT.
  5. **Chuyên gia**: tham số LM. Nằm trong mục "Nâng cao", đóng mặc định.
- Dùng component có sẵn trong `components/ui/`: `collapsible` (vai trò "Disclosure that hides secondary content", animation 240 ms), `select`, `slider`, `switch`, `toggle-group`, `input`, `tooltip`, `tabs` (Pha 3: Tạo mới / Cover / Repaint). Theo luật đã có: bán kính theo token, không glow, blur hay gradient.
- Trạng thái mở/đóng của các mục và thiết lập gần nhất lưu vào localStorage, bọc try/catch. Có nút **"Khôi phục mặc định"**.
- Mọi chuỗi đi qua `t('musicStudio.*')`. Các tên key, nhịp và mã ngôn ngữ cũng có khóa i18n riêng.
- Panel không được chiếm hết màn hình: các mục ngoài "Cơ bản" đóng mặc định, để người mới vẫn thấy trang gọn như hiện tại.

---

## 5. Kiểm thử và các cổng CI

- `tests/test_music_service.py`:
  - **Viết lại** `test_payload_never_invokes_the_language_model` thành "payload không bao giờ bật LM trừ khi yêu cầu chọn bật". Không xóa test này.
  - Thêm test: `MusicRequest()` mặc định cho payload **giống hệt** payload hiện tại (snapshot), để bảo vệ `bgm.py`.
  - Thêm test: server khởi động lại với `ACESTEP_INIT_LLM=true` khi yêu cầu cần LM; không khởi động lại khi không cần.
  - Thêm test: đo VRAM thấp thì trả lỗi `music_llm_vram`, không âm thầm tắt LM.
  - Thêm test: batch lưu đủ N bài, và từ chối ngay khi thư viện không đủ chỗ.
  - Thêm test: `media_type` đúng theo định dạng file.
  - Thêm test: record thư viện cũ, chưa có `params`, vẫn đọc được.
  - Pha 3: thêm test resolve `source_track_id`/`upload_id`, chống path traversal, từ chối đường dẫn thô.
- `music-page.test.tsx`:
  - panel Nâng cao đóng mặc định;
  - Thinking bị vô hiệu khi `llm_supported=false`;
  - "Tự động" ẩn các ô bpm/key;
  - body gửi đi đúng tên trường;
  - "dùng lại thiết lập" nạp đúng form.
- **OpenAPI/mobile:** `GenerateBody` đổi thì phải chạy `uv run python scripts/export_openapi.py`, nếu không `tests/test_mobile_contract.py` báo drift. Tính năng mới chỉ dành cho desktop thì ghi rõ trong `mobile/contract/SPEC.md` (một tính năng mobile ra cả hai nền tảng hoặc không ra).
- **i18n:** thêm khóa `musicStudio.*` vào **cả 21** file `electron/src/renderer/src/i18n/locales/*.json` (`tests/test_locale_parity.py`, `bun run locale:check`). Không để chuỗi CJK cứng trong code (`tests/test_no_hardcoded_cjk.py`).
- **Thiết kế:** các test guard CSS/component hiện có (`control-geometry`, `roles`, `select-items`…) phải xanh.
- **Tài liệu và changelog** (luật docs-sync): cập nhật `docs/music-studio.md` (chế độ Thinking, yêu cầu VRAM, ý nghĩa từng nút, nút nào chỉ dùng cho base/SFT) và thêm mục `## [Unreleased]` trong `CHANGELOG.md` theo đúng văn phong một dòng. Pha 3 tải thêm model thì cập nhật cả `docs/licensing/` và `model_licenses.json`.
- **Kiểm chứng thực tế:** mỗi pha sinh thử cùng prompt + seed trước và sau, nghe so sánh (không lời và có lời tiếng Việt/Anh). Ghi VRAM và thời gian trên ít nhất một máy CUDA và một máy Apple Silicon.

---

## 6. Rủi ro và câu hỏi mở

1. **LM trên macOS/CPU** ở revision pin: dùng `mlx` hay `pt`, có chạy được không, nhanh đến đâu. Phải thử trước khi viết code Pha 1.
2. **VRAM:** DiT turbo cộng LM 1.7B cộng các engine khác của app. `gpu_exclusive` đã dừng engine nhạc khi rảnh; cần xác nhận nó cũng giải phóng đủ bộ nhớ khi chuyển sang chế độ có LM.
3. **Thời gian khởi động lại** khi bật/tắt LM (nạp thêm vài GB). Cân nhắc giữ server có LM nếu người dùng đã bật Thinking ở lần trước.
4. **Kết quả `query_result` nhiều file** (batch): kiểm tra định dạng thật ở revision pin trước khi sửa parser.
5. **Extend:** ngữ nghĩa chính xác cần thử nghiệm (xem Pha 3).
6. **ace-step-ui không có LICENSE:** nếu sau này muốn tái dùng code thật, cần mở issue nhờ tác giả thêm file. Kế hoạch này không phụ thuộc vào việc đó.

## 7. Thứ tự đề xuất PR

1. PR-1 (Pha 1 backend + UI tối thiểu): metadata (ngôn ngữ, key, nhịp, seed), lưu `params`/seed, Thinking với kiểm tra VRAM, test, OpenAPI, i18n, docs.
2. PR-2 (Pha 2): batch, steps/ODE-SDE, định dạng, thẻ lời, chip style, format cục bộ, dùng lại thiết lập.
3. PR-3 (Pha 3a): upload an toàn, cover, repaint, extend.
4. PR-4 (Pha 3b): tải model SFT/base/LM 0.6B và các nút chỉ dành cho base.
