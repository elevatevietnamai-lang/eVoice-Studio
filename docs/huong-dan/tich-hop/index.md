---
title: Tích hợp
description: Kết nối eVoice Studio với trợ lý AI, quy trình tự động và ứng dụng ngoài qua MCP hoặc API cục bộ.
slug: tich-hop
order: 14
group: more
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Tích hợp** giúp bạn kết nối eVoice Studio với các công cụ lập trình AI, nền tảng tự động hóa, dịch vụ cuộc gọi và ứng dụng bên ngoài. Mọi tác vụ tạo giọng nói, nhân bản giọng và chép lời đều xử lý trực tiếp trên máy của bạn qua endpoint MCP hoặc API cục bộ mà không cần cài thêm máy chủ riêng.

## Cần chuẩn bị

- Mở sẵn eVoice Studio trên máy để backend cục bộ hoạt động (mặc định ở cổng `3900`).
- Chuẩn bị ít nhất một giọng nói trong mục **Giọng nói** nếu bạn muốn gán giọng riêng cho từng ứng dụng kết nối.
- Cài sẵn công cụ bạn muốn kết nối như **Claude Code**, **Cursor**, **Codex CLI**, **n8n** hoặc **Docker**.

## Các bước

### 1. Mở danh sách tích hợp

Bấm biểu tượng công cụ ở thanh điều hướng bên trái (hoặc mở mục **Thêm** rồi chọn **Tích hợp**) để vào danh sách các công cụ hỗ trợ.

![Danh sách các tích hợp trong eVoice Studio](shots/mo-trang.png)

Nhập tên công cụ, địa chỉ trang web hoặc tính năng vào ô **Tìm kiếm…** để lọc nhanh.

Bấm một trong các nút lọc danh mục gồm **Tất cả**, **Cuộc gọi & agent giọng nói**, **Tự động hóa**, **Agent**, **MCP** hoặc **Công cụ nhà phát triển** để thu hẹp danh sách hiển thị. Mỗi thẻ trên lưới đều gắn nhãn **Hoạt động với eVoice Studio** kèm các khả năng hỗ trợ như **Máy chủ MCP**, **API giọng nói**, **API chép lời**, **Mẫu quy trình**, **Tự lưu trữ**, **Mô hình ngôn ngữ cục bộ** hoặc **Cuộc gọi điện thoại**.

### 2. Mở chi tiết tích hợp

Bấm vào thẻ của công cụ bạn muốn dùng (ví dụ **Claude Code**, **Cursor**, **Codex CLI**, **Model Context Protocol**, **VoiceStudio API**, **OpenAI Agents**, **n8n**, **Twilio**, **Docker** hoặc **GitHub Container Registry**) để mở trang hướng dẫn thiết lập chi tiết.

Xem phần **Trạng thái và chi tiết** cùng danh sách **Khả năng** ở khung thông tin để kiểm tra các tính năng được hỗ trợ.

Bấm **Tìm hiểu thêm** nếu bạn muốn đọc tài liệu hướng dẫn chi tiết, hoặc mở thẻ **Trang web** để truy cập trang chính thức của nhà cung cấp. Bấm **Quay lại** khi bạn muốn trở về danh sách **Tích hợp**.

### 3. Bật MCP hoặc kết nối API cục bộ

Chọn cách kết nối phù hợp với công cụ bạn vừa mở:

- Với **Claude Code**, **Cursor** và **Codex CLI**: Sao chép đoạn **Cấu hình máy khách** trên trang chi tiết rồi dán vào tệp cấu hình tương ứng của công cụ (`.mcp.json` cho **Claude Code**, `.cursor/mcp.json` cho **Cursor** hoặc `~/.codex/config.toml` cho **Codex CLI**). Các cấu hình này kết nối qua địa chỉ `http://127.0.0.1:3900/mcp/` và gửi kèm mã định danh client.
- Với các ứng dụng MCP khác: Mở thẻ **Model Context Protocol**, sao chép địa chỉ Streamable HTTP (`http://localhost:3900/mcp/`) hoặc cấu hình **Shim stdio** (`python -m backend.mcp_shim`) nếu ứng dụng chỉ hỗ trợ giao tiếp stdio.
- Với **VoiceStudio API** và **OpenAI Agents**: Mở thẻ tương ứng, sao chép **URL cơ sở** tương thích chuẩn OpenAI cùng các đoạn lệnh mẫu **Chuyển văn bản thành giọng nói (curl)**, **Chép lời (curl)** hoặc mã Python để gọi trực tiếp tới `/v1/audio/speech` và `/v1/audio/transcriptions` trên máy.
- Với **n8n**: Mở thẻ **n8n** để lấy **Quy trình n8n** mẫu, nhập vào **n8n** rồi chỉnh nội dung văn bản và giọng đọc trước khi tự chạy quy trình.
- Với **Docker** và **GitHub Container Registry**: Sao chép lệnh trong mục **Chạy container** hoặc **Chạy container (Windows PowerShell)** để khởi chạy eVoice Studio dưới dạng máy chủ tự lưu trữ có sẵn API và endpoint MCP.
- Với **Twilio**: Làm theo các bước thiết lập tài khoản, số điện thoại, giọng trả lời và đường hầm HTTPS riêng trên trang chi tiết khi bạn cần tính năng **Cuộc gọi điện thoại** (mặc định tính năng này tắt và chỉ kết nối mạng khi bạn chủ động bật).

## Mẹo

- Chọn **Gán cho mỗi client một giọng riêng trong Cài đặt** để đặt giọng đọc mặc định riêng cho từng trợ lý AI (như `claude-code`, `cursor`, `codex-cli`). Khi gọi công cụ tạo giọng nói mà không truyền mã giọng cụ thể, ứng dụng sẽ tự dùng giọng đã gán cho client đó.
- Giữ dấu gạch chéo ở cuối đường dẫn `/mcp/` khi cấu hình kết nối HTTP để tương thích với mọi phiên bản backend.
- Đặt biến môi trường `OMNIVOICE_MCP_OUTPUT_MODE=files` kèm thư mục `OMNIVOICE_MCP_BASE_PATH` nếu bạn muốn công cụ MCP lưu âm thanh ra tệp trên ổ cứng thay vì trả dữ liệu WAV dạng base64 trực tiếp vào ngữ cảnh của agent.

## Lỗi thường gặp

- Danh sách hiện thông báo **Không có kết quả**: Xóa từ khóa trong ô **Tìm kiếm…** hoặc bấm lại nút **Tất cả** để bỏ bộ lọc danh mục đang chọn.
- Trợ lý AI báo không kết nối được tới máy chủ MCP: Kiểm tra xem cửa sổ eVoice Studio có đang mở và báo **Thiết bị cục bộ: Engine sẵn sàng** hay không, đồng thời đối chiếu cổng trong tệp cấu hình với cổng backend hiện tại (mặc định là `3900`).
- Công cụ MCP từ chối đọc hoặc ghi tệp âm thanh theo đường dẫn: Kiểm tra xem bạn đã khai báo thư mục được phép truy cập trong biến môi trường `OMNIVOICE_MCP_BASE_PATH` chưa, vì eVoice Studio chặn mọi đường dẫn nằm ngoài thư mục cơ sở này để bảo mật.
- Gọi MCP hoặc API từ máy khác trong mạng nội bộ bị từ chối: Mở **Cài đặt** để bật chia sẻ mạng nội bộ, dùng đúng địa chỉ LAN kèm mã PIN truy cập trong header `X-OmniVoice-Pin`, hoặc cấu hình biến `OMNIVOICE_MCP_ALLOWED_HOSTS` khi chạy qua container.

## Bài liên quan

- [Cài đặt](../cai-dat/)
- [Quy trình tự động](../quy-trinh/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Phiên âm và đọc chính tả](../phien-am/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
