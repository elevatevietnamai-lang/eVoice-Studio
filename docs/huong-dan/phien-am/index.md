---
title: Phiên âm và đọc chính tả
description: Hướng dẫn chép lời file âm thanh, xem lịch sử phiên âm và dùng đọc chính tả trực tiếp trên máy với eVoice Studio.
slug: phien-am
order: 11
group: more
updated: 2026-11-15
app_version: 0.5.7-beta.3
status: approved
---

## Tính năng này làm gì

Trang **Chép lời** giúp bạn chuyển giọng nói từ file âm thanh hoặc từ micrô thành văn bản ngay trên máy mà không cần kết nối mạng. Bạn cũng có thể dùng tính năng **Đọc chính tả** bằng phím tắt toàn cục để nói và chèn chữ trực tiếp vào bất kỳ ứng dụng nào đang mở.

## Cần chuẩn bị

- Đã cài ít nhất một model **Đọc chính tả** (như Whisper Tiny được khuyến nghị mặc định cho hơn 90 ngôn ngữ, hoặc Parakeet TDT v3 cho 25 ngôn ngữ châu Âu) hoặc model ASR trong mục **Cài đặt**. Nếu chưa có model, trang **Chép lời** sẽ hiện danh sách để bạn bấm tải về trước khi bắt đầu.
- Một file âm thanh (`.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.webm`) nếu bạn muốn chép lời từ file, hoặc micrô đã được cấp quyền truy cập trên hệ điều hành nếu muốn thu âm và đọc chính tả.

## Các bước

### 1. Chép lời một file âm thanh hoặc thu âm trực tiếp

![Trang Chép lời trong eVoice Studio](shots/mo-trang.png)

1. Bấm **Thêm** ở thanh điều hướng bên trái rồi chọn **Chép lời** (hoặc dùng ô **Tìm kiếm…** ở thanh trên cùng).
2. Chọn chế độ ở thanh công cụ phía trên:
   - **Nhanh**: dùng model đọc chính tả có độ trễ thấp.
   - **Chính xác**: dùng model ASR kèm dấu thời gian chi tiết cho từng đoạn.
3. Mở mục **Thiết bị đầu vào** nếu bạn cần đổi micrô hoặc chọn kênh thu trước khi ghi âm.
4. Bấm **Tải âm thanh lên** rồi chọn file trên máy để bắt đầu chép lời, hoặc bấm **Thu âm** để ghi một đoạn từ micrô rồi dừng lại cho máy xử lý.

### 2. Xem lịch sử phiên âm

1. Nhìn sang cột **Lịch sử** ở bên trái (lưu tối đa 200 bản mới nhất) và bấm vào bản chép lời bạn muốn xem.
2. Nhập từ khóa vào ô **Tìm kiếm bản chép lời…** nếu bạn cần lọc nhanh theo nội dung hoặc ngôn ngữ.
3. Mở mục **Đoạn** trong phần nội dung chính để xem chi tiết từng câu kèm mốc thời gian, hoặc mở **Bản chép lời gốc** nếu bạn có bật tính năng làm sạch văn bản tự động.
4. Bấm **Sao chép** để chép văn bản vào bảng nhớ tạm, bấm **Xuất** để lưu bản đang chọn ra file `.txt`, hoặc bấm **Xuất tất cả** ở cuối cột **Lịch sử** để lưu toàn bộ.
5. Bấm **Xóa** ở góc bản chép lời để xóa từng mục, hoặc bấm **Xóa tất cả** rồi chọn **Xác nhận** để dọn trống danh sách.

### 3. Bật đọc chính tả trực tiếp

1. Bấm **Bắt đầu đọc chính tả** ở giữa trang (hoặc nút **Đọc chính tả** trên thanh công cụ khi đã có lịch sử) và bắt đầu nói vào micrô.
2. Quan sát văn bản hiện trực tiếp trên màn hình trong lúc bạn nói; bạn có thể bấm **Tạm dừng** để ngừng thu tạm thời rồi bấm **Tiếp tục** trong cùng phiên.
3. Bấm **Dừng** khi nói xong để lưu kết quả vào **Lịch sử**, hoặc bấm **Hủy** nếu muốn bỏ phiên đang thu.
4. Đặt con trỏ chuột vào ô nhập liệu của bất kỳ ứng dụng nào rồi nhấn phím tắt đọc chính tả toàn cục nếu bạn muốn đọc chữ trực tiếp từ ngoài eVoice Studio: thanh nổi nhỏ sẽ ghi âm và tự động dán văn bản vào ứng dụng đó (hoặc chép sẵn vào bảng nhớ tạm nếu hệ điều hành không cho phép tự động chèn).

### 4. Đặt phím tắt

1. Bấm **Cài đặt** ở thanh điều hướng bên trái để mở phần thiết lập model và phím tắt cho **Đọc chính tả**.
2. Chọn kiểu kích hoạt phím tắt phù hợp với thói quen của bạn: nhấn giữ phím để nói và thả phím để dừng, hoặc nhấn một lần để bắt đầu và nhấn lần nữa để dừng.
3. Nhấn tổ hợp phím bạn muốn dùng rồi bấm **Lưu** để áp dụng.

## Mẹo

- Khi đọc chính tả bằng phím tắt ở ứng dụng khác, eVoice Studio tự động giữ lại nội dung sẵn có trong bảng nhớ tạm của bạn (văn bản, HTML, hình ảnh hoặc danh sách file) và khôi phục lại sau khi dán xong bản chép lời.
- Trong phần thiết lập của model **Đọc chính tả**, bạn có thể bật thêm các tùy chọn làm sạch văn bản bằng LLM như **Xóa từ đệm**, **Áp dụng tự sửa lời nói** và **Giữ thuật ngữ kỹ thuật**. Bản gốc vẫn luôn được giữ lại trong mục **Bản chép lời gốc**.
- Nếu bạn vừa đọc chính tả vừa nghe âm thanh phát ra từ ứng dụng, hãy bật tùy chọn **Đọc chính tả khi đang phát âm thanh** (**Bật khử tiếng vọng khi đọc chính tả**) để loại tiếng phát ra khỏi micrô.

## Lỗi thường gặp

- hiện thông báo **Không thể bắt đầu đọc chính tả. Kiểm tra quyền truy cập micrô rồi thử lại.**: kiểm tra lại quyền truy cập micrô của hệ điều hành dành cho eVoice Studio và xem lại thiết bị đã chọn trong mục **Thiết bị đầu vào**.
- nút **Bắt đầu đọc chính tả** hoặc **Tải âm thanh lên** bị mờ không bấm được: model cho chế độ đang chọn chưa được cài hoặc chưa kích hoạt; hãy bấm tải model ngay trên thông báo ở đầu trang hoặc mở **Cài đặt** để chọn model đã cài sẵn trên máy.
- hiện thông báo **Chép lời thất bại** sau khi tải file lên: bấm **Thử lại** ngay trên thanh thông báo, hoặc mở mục **Chi tiết** để xem nguyên nhân lỗi trước khi thử file khác.
- hiện thông báo **Làm sạch văn bản quá thời gian. Đã giữ nguyên bản chép lời gốc.** hoặc **Làm sạch văn bản thất bại. Đã giữ nguyên bản chép lời gốc.**: bước xử lý hậu kỳ không hoàn tất kịp nhưng nội dung bạn vừa đọc vẫn an toàn; bạn có thể dùng ngay văn bản ở **Bản chép lời gốc**.
- đọc chính tả bằng phím tắt chỉ báo đã sao chép chứ không tự điền chữ vào cửa sổ đang mở: trên macOS chưa cấp quyền Trợ năng (Accessibility), trên Linux đang chạy phiên Wayland hoặc cửa sổ đích từ chối nhận tiêu điểm; bạn chỉ cần nhấn tổ hợp phím dán (`Ctrl+V` hoặc `Command+V`) để dán văn bản đã được chép sẵn.

## Bài liên quan

- [Bắt đầu với eVoice Studio](../bat-dau/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Lồng tiếng video](../long-tieng-video/)
- [Cài đặt](../cai-dat/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
