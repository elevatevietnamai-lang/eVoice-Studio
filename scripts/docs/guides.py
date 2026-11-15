"""The Vietnamese user guide (docs/huong-dan/): article list, outlines and shared helpers.

One table drives the capture scenarios' order, the writer (generate_guides.py), the checker
(check_guides.py) and the landing page's table of contents. Outlines follow PLAN-docs-tai-lieu.md
section 1; code and docs listed per article are the facts the writer may draw on.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDES_DIR = ROOT / "docs" / "huong-dan"
LOCALES = ROOT / "electron" / "src" / "renderer" / "src" / "i18n" / "locales"
FEATURES = "electron/src/renderer/src/features"

GROUPS = {
    "start": "Bắt đầu",
    "voice": "Giọng nói",
    "stories": "Truyện và âm nhạc",
    "dub": "Lồng tiếng và video",
    "more": "Công cụ khác",
    "library": "Thư viện và hệ thống",
}

REQUIRED_FRONT_MATTER = ("title", "description", "slug", "order", "group", "updated", "app_version", "status")


@dataclass(frozen=True)
class Guide:
    order: int
    slug: str
    title: str
    group: str
    outline: str
    namespaces: tuple[str, ...]
    sources: tuple[str, ...] = field(default=())
    code: tuple[str, ...] = field(default=())


GUIDES: tuple[Guide, ...] = (
    Guide(1, "bat-dau", "Bắt đầu với eVoice Studio", "start",
          "Cài app: bản beta eVoice Studio hiện CHỈ có bộ cài Windows 10/11 x64, file "
          "eVoice-Studio-Electron-<phiên bản>-win-x64.exe tải từ trang Releases của "
          "github.com/elevatevietnamai-lang/eVoice-Studio (hoặc nút tải trên evoice.elevatemarketing.vn); bộ cài chưa ký "
          "số nên SmartScreen có thể cảnh báo (Thông tin thêm → Vẫn chạy); macOS và Linux chưa có, không viết cách cài "
          "cho hai hệ này và không nhắc tên file hay lệnh của VoiceStudio gốc → lần mở đầu: kiểm tra hệ thống, gói model, quyền riêng tư "
          "(hỏi đồng ý analytics, mặc định tắt) → tải model đầu tiên ở Cài đặt → Model → tham quan thanh "
          "điều hướng và Trang chủ → đổi ngôn ngữ và theme ở Cài đặt → Giao diện",
          ("nav", "homeUi", "setup", "settings", "appearance"),
          ("docs/install/windows.md", "docs/downloading-models.md",
           "docs/electron-launchpad.md"),
          (f"{FEATURES}/home/home-page.tsx",)),
    Guide(2, "nhan-ban-giong", "Nhân bản giọng", "voice",
          "Thêm audio mẫu (tải lên hoặc thu âm, 5–15 giây) → chép lời mẫu → chọn giọng đã lưu → nhập kịch bản → "
          "chọn ngôn ngữ và chất lượng → Tổng hợp âm thanh → nghe bản tạo và lưu thành giọng → chỉ nhân bản "
          "giọng của chính bạn hoặc người đã đồng ý",
          ("clone", "cloneFlow", "referenceAsr", "nav"),
          ("docs/feature-catalog.md",),
          (f"{FEATURES}/clone/clone-page.tsx", f"{FEATURES}/clone/action-bar.tsx")),
    Guide(3, "giong-da-luu", "Quản lý giọng đã lưu", "voice",
          "Danh sách giọng đã lưu → nghe thử, sửa tên và ảnh đại diện → thay audio mẫu → xuất và nhập giọng → xóa giọng",
          ("persona", "profiles", "nav", "cloneFlow"),
          ("docs/profile-portraits.md",),
          (f"{FEATURES}/clone/saved-voices-page.tsx",)),
    Guide(4, "thiet-ke-giong", "Thiết kế giọng bằng mô tả", "voice",
          "Viết mô tả giọng hoặc chọn tính cách có sẵn → tạo bản nghe thử → chỉnh mô tả → lưu thành giọng",
          ("designWorkspace", "design", "nav"),
          ("docs/electron-voice-design.md", "docs/voice-design.md"),
          (f"{FEATURES}/design/design-page.tsx",)),
    Guide(5, "thu-vien-giong", "Thư viện giọng", "voice",
          "Duyệt và lọc giọng mẫu → nghe thử → dùng hoặc nhập giọng → thư viện cộng đồng (chỉ kết nối mạng khi bạn bật)",
          ("gallery", "nav"),
          ("docs/electron-gallery.md",),
          (f"{FEATURES}/gallery/gallery-page.tsx",)),
    Guide(6, "long-tieng-video", "Lồng tiếng video", "dub",
          "Chọn tệp video hoặc dán URL → chọn ngôn ngữ nói → chọn ngôn ngữ lồng tiếng → chọn cách dịch (Dịch bằng "
          "agent hoặc Dịch thuật) và chất lượng dịch → chép lời, dịch, gán giọng → sửa từng đoạn trên timeline → "
          "nhạc nền và phụ đề cứng (hardsub) → tạo lồng tiếng và xuất file → lưu dự án",
          ("dub", "dubWorkspace", "nav"),
          ("docs/electron-dubbing.md", "docs/dub-hardsub.md"),
          (f"{FEATURES}/dub/dub-page.tsx",)),
    Guide(7, "long-tieng-hang-loat", "Lồng tiếng hàng loạt", "dub",
          "Thêm nhiều video → chọn ngôn ngữ và cấu hình chung → thư mục theo dõi (watch folder) → theo dõi hàng đợi",
          ("batch", "nav"),
          ("docs/electron-batch.md",),
          (f"{FEATURES}/batch/batch-page.tsx",)),
    Guide(8, "truyen", "Truyện nhiều giọng", "stories",
          "Dán hoặc nhập truyện → tự phân vai → gán giọng cho từng nhân vật → nghe thử từng đoạn → tạo → xuất file",
          ("stories", "longform", "nav"),
          ("docs/electron-longform.md",),
          (f"{FEATURES}/longform/longform-page.tsx",)),
    Guide(9, "sach-noi", "Sách nói", "stories",
          "Nhập sách → đánh dấu chương → cài đặt giọng đọc → tạo → nghe với chữ chạy theo audio → xuất",
          ("audiobook", "longform"),
          ("docs/electron-longform.md",),
          (f"{FEATURES}/longform/longform-page.tsx",)),
    Guide(10, "studio-am-nhac", "Studio âm nhạc", "stories",
          "Cài engine ACE-Step (tải model lần đầu) → viết mô tả và lời bài hát → tạo → nghe và tải về",
          ("musicStudio",),
          ("docs/music-studio.md",),
          (f"{FEATURES}/music/music-page.tsx",)),
    Guide(11, "phien-am", "Phiên âm và đọc chính tả", "more",
          "Chép lời một file audio hoặc video → xem lịch sử phiên âm → bật đọc chính tả trực tiếp → đặt phím tắt",
          ("transcriptions", "dictation", "nav"),
          ("docs/electron-transcriptions.md", "docs/features/dictation.md"),
          (f"{FEATURES}/transcriptions/transcriptions-page.tsx",)),
    Guide(12, "quy-trinh", "Quy trình tự động", "more",
          "Tạo quy trình → nối các bước → chạy → xem kết quả",
          ("workflows",),
          ("docs/electron-workflows.md",),
          (f"{FEATURES}/workflows/workflows-page.tsx",)),
    Guide(13, "cong-cu", "Công cụ: so sánh và chuyển giọng", "more",
          "Mở trang Công cụ → so sánh hai giọng → chuyển giọng một file audio sang giọng đã lưu → các tiện ích audio khác",
          ("tools", "compare", "convert"),
          ("docs/electron-tools.md",),
          (f"{FEATURES}/tools/tools-page.tsx",)),
    Guide(14, "tich-hop", "Tích hợp", "more",
          "Danh sách tích hợp → mở chi tiết → bật MCP hoặc API cục bộ",
          ("integrationCatalog", "integrations"),
          ("docs/mcp.md", "docs/integration-directory.md"),
          (f"{FEATURES}/integrations/integrations-page.tsx",)),
    Guide(15, "du-an", "Dự án", "library",
          "Mở danh sách dự án → mở, đổi tên, nhân bản, xóa → chuyển dự án lồng tiếng thành truyện",
          ("projects",),
          ("docs/electron-projects.md",),
          (f"{FEATURES}/projects/projects-page.tsx",)),
    Guide(16, "cai-dat", "Cài đặt", "library",
          "Một bài chia mục theo ảnh: Chung · Giao diện · Model · Mạng và mirror Hugging Face · Hiệu năng · Lưu trữ · "
          "Quyền riêng tư · Cập nhật (bản eVoice không tự cập nhật: tải bộ cài mới rồi cài đè)",
          ("settings", "appearance", "privacy", "storage", "performance", "updates", "network"),
          ("docs/electron-privacy.md", "docs/electron-storage.md", "docs/electron-performance.md"),
          (f"{FEATURES}/settings/settings-page.tsx",)),
    Guide(17, "khac-phuc-su-co", "Khắc phục sự cố", "library",
          "Đọc nhật ký → chạy chẩn đoán → trợ lý sửa lỗi → báo lỗi qua GitHub bằng URL điền sẵn (gửi từ trình duyệt của bạn)",
          ("logs", "diagnostics", "repairAgent"),
          ("docs/electron-logs.md", "docs/electron-repair.md", "docs/install/troubleshooting.md"),
          ()),
    Guide(18, "video-quang-cao", "Video quảng cáo (Promo)", "dub",
          "Mở trang Video quảng cáo → thêm clip, ảnh, nhạc → chọn mẫu cảnh → xem trước → xuất video",
          ("promo",),
          ("docs/electron-promo.md",),
          (f"{FEATURES}/promo/promo-page.tsx",)),
    Guide(19, "trinh-dung-video", "Trình dựng video", "dub",
          "Mở Dựng video → thêm clip vào timeline nhiều track → cắt, thêm chữ và âm thanh → xuất video",
          ("editor",),
          ("docs/electron-video-editor.md",),
          (f"{FEATURES}/video-editor/editor-page.tsx",)),
)

BY_SLUG = {guide.slug: guide for guide in GUIDES}


def flat(tree: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in tree.items():
        dotted = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flat(value, dotted))
        elif isinstance(value, str):
            out[dotted] = value
    return out


def locale(code: str) -> dict[str, str]:
    return flat(json.loads((LOCALES / f"{code}.json").read_text(encoding="utf-8")))


def manifest(slug: str) -> dict | None:
    path = GUIDES_DIR / slug / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    match = FRONT_MATTER.match(text.replace("\r\n", "\n"))
    if not match:
        return {}, text
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip('"')
    return meta, text.replace("\r\n", "\n")[match.end():]
