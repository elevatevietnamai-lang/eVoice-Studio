---
title: Lồng tiếng hàng loạt
description: Hướng dẫn thêm nhiều video, chọn ngôn ngữ đích, bật thư mục theo dõi và quản lý hàng đợi lồng tiếng hàng loạt trong eVoice Studio.
slug: long-tieng-hang-loat
order: 7
group: dub
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Lồng tiếng hàng loạt** giúp bạn dịch và lồng tiếng nhiều tệp video cùng lúc sang một hoặc nhiều ngôn ngữ đích ngay trên máy. Bạn có thể thiết lập sẵn giọng đọc, tùy chọn giữ nhạc nền và bật chế độ tự động xử lý mỗi khi có video mới thêm vào thư mục.

## Cần chuẩn bị

- Một hoặc nhiều tệp video cần lồng tiếng (định dạng `.mp4`, `.mkv`, `.mov` hoặc `.webm`).
- Model nhận diện giọng nói, engine dịch thuật và tạo giọng nói đã sẵn sàng trên máy.
- Hồ sơ giọng đã lưu hoặc mẫu giọng cài sẵn nếu bạn muốn dùng giọng đọc riêng thay cho giọng mặc định.

## Các bước

### 1. Mở trang và thêm nhiều video

Bấm vào **Lồng tiếng** trên thanh điều hướng bên trái để mở không gian làm việc **Lồng tiếng hàng loạt**, hoặc tìm nhanh qua ô **Tìm kiếm…**.

![Giao diện trang Lồng tiếng hàng loạt](shots/mo-trang.png)

Bấm nút **Thêm video** ở cột bên trái (hoặc kéo thả trực tiếp các tệp video vào khung **Thả video ở trên để bắt đầu lồng tiếng hàng loạt.**). Các tệp hợp lệ sẽ hiện trong danh sách kèm dung lượng; nếu chọn nhầm tệp, bạn bấm nút xóa bên cạnh tên tệp để bỏ ra khỏi danh sách chờ.

### 2. Chọn ngôn ngữ và cấu hình chung

Chọn ngôn ngữ cần xuất trong khung **NGÔN NGỮ ĐÍCH**. Mặc định thẻ **Spanish** được chọn sẵn; bạn mở hộp chọn **Ngôn ngữ** để thêm các ngôn ngữ đích khác hoặc bấm dấu đóng trên thẻ **Spanish** để gỡ bỏ.

Bấm mở mục **GIỌNG NÓI** nếu muốn đổi giọng đọc:
- Chọn **Mặc định** để dùng giọng tiêu chuẩn của engine.
- Chọn một giọng trong danh sách hồ sơ nhân bản giọng hoặc dưới mục **Mẫu cài sẵn**.

Bật hoặc tắt công tắc **Giữ âm thanh nền (nhạc/hiệu ứng)** tùy theo nhu cầu giữ lại tiếng nhạc và hiệu ứng gốc của video.

### 3. Bật thư mục theo dõi (watch folder)

Bấm vào **Theo dõi thư mục** ở cuối cột bên trái và chọn một thư mục trên máy tính nếu bạn muốn tự động hóa quy trình. Khi tính năng này hoạt động, mỗi tệp video mới chép hoàn tất vào thư mục đó sẽ tự động được đưa vào hàng đợi với ngôn ngữ đích, giọng nói và tùy chọn **Giữ âm thanh nền (nhạc/hiệu ứng)** đang chọn. Trong lúc theo dõi, bạn có thể bấm **Tạm dừng**, **Tiếp tục** hoặc **Dừng** bất cứ lúc nào.

### 4. Đưa vào hàng đợi và theo dõi tiến độ

Bấm **Thêm vào hàng đợi** để bắt đầu gửi danh sách video đi xử lý. Các tệp gửi thành công sẽ chuyển sang danh sách tác vụ bên phải; những tệp chưa gửi được vẫn nằm lại ở cột bên trái để bạn kiểm tra.

Chọn các thẻ trạng thái ở phía trên vùng danh sách để kiểm tra tiến độ:
- **Đang xử lý**: hiển thị các video đang chờ (**đang chờ**) hoặc đang chạy (**đang chạy**) qua từng công đoạn (**🎬 Đang tách âm thanh…**, **📝 Đang chép lời…**, **🌐 Đang dịch…**, **🗣️ Đang tạo giọng nói…**, **🎛️ Đang trộn âm thanh…**, **✅ Hoàn tất**) kèm phần trăm hoàn thành. Bạn có thể bấm **Hủy** nếu muốn dừng tác vụ đang chạy.
- **Đã hoàn thành**: liệt kê các video đã xử lý xong (**xong**). Bạn bấm nút tải xuống ứng với từng ngôn ngữ để lưu tệp `.mp4` về máy, hoặc bấm **Xóa** (và xác nhận **Xóa** lần nữa, hoặc **Hủy**) để dọn khỏi danh sách.
- **Thất bại**: liệt kê các tác vụ gặp sự cố (**thất bại**) hoặc bị dừng (**đã hủy**). Bạn có thể mở **Thêm thông tin** để xem chi tiết lỗi và bấm **Thử lại** để chạy lại tác vụ.

Bấm **Làm mới** ở góc phải phía trên danh sách khi cần cập nhật trạng thái ngay lập tức.

## Mẹo

- Bạn có thể chọn nhiều ngôn ngữ trong **NGÔN NGỮ ĐÍCH** cho cùng một đợt chạy; ứng dụng sẽ tự nhân số lượng video với số ngôn ngữ để xử lý lần lượt và xuất tệp riêng cho từng ngôn ngữ.
- Hãy thiết lập xong **NGÔN NGỮ ĐÍCH**, **GIỌNG NÓI** và **Giữ âm thanh nền (nhạc/hiệu ứng)** trước khi bấm **Theo dõi thư mục** để mọi video chép vào thư mục đều dùng đúng cấu hình mong muốn.
- Hàng đợi tác vụ được lưu trong bộ nhớ tạm khi ứng dụng đang chạy; bạn nên đợi các tác vụ trong **Đang xử lý** hoàn tất trước khi đóng hoàn toàn ứng dụng.

## Lỗi thường gặp

- Nút **Thêm vào hàng đợi** bị mờ không bấm được: kiểm tra xem bạn đã thêm ít nhất một tệp video, đã chọn ít nhất một ngôn ngữ trong **NGÔN NGỮ ĐÍCH**, và model hoặc engine dịch hiển thị ở dòng trạng thái đã tải xong chưa (không còn báo **Đang tải…**).
- Tác vụ chuyển sang thẻ **Thất bại** do thiếu gói ngôn ngữ dịch hoặc chưa chấp nhận giấy phép model: mở thẻ **Thất bại**, xem thông báo trên thẻ tác vụ, xác nhận giấy phép hoặc cài đặt gói ngôn ngữ khi được hỏi rồi bấm **Thử lại**.
- Xuất hiện thông báo **Không thể theo dõi thư mục đó — chọn lại để thử lại.** khi bật thư mục theo dõi: kiểm tra lại quyền truy cập thư mục trên máy tính, sau đó bấm **Theo dõi thư mục** và chọn lại thư mục một lần nữa.

## Bài liên quan

- [Lồng tiếng video](../long-tieng-video/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Quy trình tự động](../quy-trinh/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
