---
title: Video quảng cáo (Promo)
description: Ghép clip, ảnh, nhạc nền, lời thuyết minh và mẫu cảnh thành video quảng cáo ngắn ngay trên máy tính với eVoice Studio.
slug: video-quang-cao
order: 18
group: dub
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Video quảng cáo** giúp bạn ghép các đoạn video ngắn và ảnh tĩnh thành một file MP4 hoàn chỉnh kèm hiệu ứng chuyển cảnh, nhạc nền, lời thuyết minh, logo và lớp phủ tiêu đề. Toàn bộ quá trình dựng và xuất video chạy cục bộ trên CPU của máy bạn bằng công cụ ffmpeg đi kèm, không gửi dữ liệu ra ngoài mạng.

## Cần chuẩn bị

- Các đoạn video hoặc ảnh tĩnh định dạng `.png`, `.jpg`, `.webp`, `.bmp` (tối đa 40 cảnh, mỗi tệp không quá 4 GB, tổng thời lượng video tối đa 5 phút).
- Tệp nhạc nền hoặc bản thu thuyết minh nếu muốn chèn âm thanh.
- Ảnh logo định dạng PNG có nền trong suốt (dung lượng tối đa 20 MB) nếu muốn đóng dấu thương hiệu hoặc tạo màn hình kết.
- Công cụ ffmpeg đã cài sẵn trong bước thiết lập đầu tiên của ứng dụng.
- Nếu muốn xuất **Tiêu đề động** hoặc **Cảnh HTML tuỳ chỉnh** thành video trên ứng dụng máy tính, lần đầu sử dụng bạn cần xác nhận tải gói Chrome Headless Shell (khoảng 271 MB).

## Các bước

### 1. Mở trang Video quảng cáo

1. Bấm **Lồng tiếng** trên thanh điều hướng chính rồi mở trang **Video quảng cáo**.
2. Chọn tỷ lệ khung hình ở mục **Khổ hình** ở cột bên trái: **9:16 dọc**, **1:1 vuông** hoặc **16:9 ngang**.
3. Chọn **Tốc độ khung hình** là **30 fps** hoặc **60 fps**.
4. Chọn bộ lọc màu tại mục **Tông màu** (**Gốc**, **Ấm**, **Lạnh**, **Rực rỡ** hoặc **Đen trắng**) để đồng bộ màu sắc giữa tất cả các cảnh.

![Trang Video quảng cáo](shots/mo-trang.png)

### 2. Thêm clip, ảnh và nhạc

1. Bấm **Thêm clip hoặc ảnh** ở góc phải mục **Cảnh** và chọn các tệp video hoặc hình ảnh từ máy tính.
2. Nhập thời lượng (từ 0,5 đến 60 giây) vào ô **Độ dài (s)** của từng cảnh.
3. Nhập mốc lấy hình vào ô **Bắt đầu (s)** nếu cảnh là video, hoặc chọn kiểu **Chuyển động** (**Đứng yên**, **Phóng to dần**, **Thu nhỏ dần**) nếu cảnh là ảnh tĩnh.
4. Chọn hiệu ứng ở mục **Chuyển cảnh vào** cho các cảnh từ vị trí thứ hai trở đi (**Cắt thẳng**, **Mờ dần**, **Loé sáng**, **Tối dần**, **Trượt**, **Đẩy**, **Quét**, **Phóng**, **Vòng tròn** hoặc **Nhoè**) và kéo thanh **Độ dài chuyển cảnh (giây)**.
5. Chọn cách căn hình ở mục **Khung hình** gồm **Lấp đầy khung** hoặc **Giữ nguyên ảnh**.
6. Bấm **Thêm nhạc** ở cột trái để chọn nhạc nền, kéo thanh **Âm lượng nhạc** và bật **Cắt theo nhịp nhạc** nếu muốn ứng dụng tự căn điểm chuyển cảnh khớp với phách nhạc.
7. Bấm **Thêm lời thuyết minh (tuỳ chọn)** để chèn file giọng đọc; nhạc nền sẽ tự động hạ nhỏ dưới giọng thuyết minh.
8. Bấm **Thêm logo (PNG)** ở mục **Logo**, chọn góc hiển thị (**Tắt**, **Trên trái**, **Trên giữa**, **Trên phải**, **Dưới trái**, **Dưới giữa**, **Dưới phải**), rồi chỉnh **Logo kết thúc (giây)** (tối đa 10 giây) và **Nền đoạn kết**.

### 3. Chọn mẫu cảnh và tiêu đề động

1. Chọn một mẫu có sẵn trong danh sách **Cảnh** của mục **Cảnh HTML tuỳ chỉnh** như **Tiêu đề đơn giản**, **Tên và chức danh**, **Đếm ngược**, **Giá và khuyến mãi**, **Chữ chạy**, **Kêu gọi hành động**, **Mở đầu**, **Kết thúc** hoặc **Slide chữ**.
2. Nhập tên vào ô **Tên**, thời lượng (từ 1 đến 60 giây) vào ô **Độ dài (giây)** và chỉnh nội dung tại khu vực **Tham số** (các cột **Khoá**, **Loại**, **Nhãn**, **Giá trị**).
3. Bấm các thẻ **HTML**, **CSS**, **JavaScript** nếu bạn muốn tự sửa mã nguồn, hoặc bấm **Viết bằng AI** để tạo bản nháp cảnh bằng nhà cung cấp LLM đã bật trong **Cài đặt**.
4. Bấm **Phát lại** dưới khung xem trước bên phải để kiểm tra chuyển động của cảnh.
5. Bấm **Thêm làm lớp phủ** để đè cảnh có nền trong suốt lên video, hoặc bấm **Thêm làm shot** để chèn cảnh thành một đoạn độc lập ở cuối danh sách **Cảnh**.
6. Cuộn xuống mục **Tiêu đề động** nếu muốn dùng các mẫu tiêu đề dựng sẵn (**Từ khoá**, **Tiêu đề phát sáng**, **Chữ viết tay**, **Thanh tìm kiếm**, **Thẻ liên hệ**, **Logo xuất hiện**), điền nội dung rồi bấm **Tạo lớp phủ** để đưa vào danh sách **Lớp phủ**.

### 4. Xem trước và chỉnh trên timeline

1. Bấm **Phát** dưới khung **Xem trước** (hoặc nhấn phím Space khi đang chọn timeline) để xem thử toàn bộ video cùng nhạc nền, lời thuyết minh, logo và lớp phủ.
2. Kéo mép phải của một cảnh trên timeline để đổi độ dài, kéo mép trái của cảnh video để cắt điểm bắt đầu, hoặc kéo cả khối cảnh để đổi thứ tự.
3. Kéo khối tiêu đề trên timeline để đổi thời điểm xuất hiện, hoặc thả tiêu đề vào một cảnh để gắn nó đi theo cảnh đó.
4. Bấm **Cắt tại đầu phát (S)** để tách đôi cảnh đang chọn tại vị trí con trỏ phát, hoặc bấm **Xoá mục đang chọn** để bỏ cảnh hay lớp phủ.

### 5. Xuất video

1. Kiểm tra tổng thời lượng hiển thị phía trên nút xuất ở cột bên trái.
2. Bấm **Xuất video** và đợi ứng dụng ghép các cảnh.
3. Xem lại thành phẩm trong khung **Kết quả** khi quá trình xử lý hoàn tất.
4. Bấm **Lưu video** để lưu tệp MP4 về máy tính.

## Mẹo

- Bấm **Lên trên** hoặc **Xuống dưới** trên từng dòng trong danh sách **Cảnh** khi bạn muốn đổi vị trí cảnh nhanh mà không cần kéo trên timeline.
- Dùng **Hoàn tác (Ctrl+Z)** và **Làm lại (Ctrl+Shift+Z)** trên thanh công cụ timeline để quay lại hoặc khôi phục bất kỳ thao tác chỉnh sửa nào.
- Bấm **Lưu** trong mục **Cảnh HTML tuỳ chỉnh** để cất mẫu cảnh đã chỉnh vào máy cho những video sau, hoặc dùng **Xuất** và **Nhập** để chia sẻ cảnh dưới dạng tệp `.html` hoặc `.zip`.
- Khi bật **Cắt theo nhịp nhạc**, bạn có thể gắn lớp phủ theo cảnh tại mục **Hiện cùng** để tiêu đề tự dịch chuyển khớp theo cảnh mỗi khi điểm cắt thay đổi.

## Lỗi thường gặp

- tệp nguồn bị xoá hoặc đổi thư mục dữ liệu khiến cảnh, nhạc hoặc logo hiện báo đỏ **Mất tệp** và nút **Xuất video** bị khoá: bấm **Xoá tệp bị mất** ở cột bên trái để gỡ toàn bộ tệp lỗi, hoặc chọn lại tệp mới cho mục đó.
- tổng thời lượng hoặc số lượng vượt mức cho phép nên xuất hiện thông báo **Video dài tối đa 5 phút.**, **Video có tối đa 40 cảnh.** hoặc **Video có tối đa 12 lớp phủ.**: rút ngắn **Độ dài (s)** của các cảnh hoặc bấm **Xoá** bớt cảnh và lớp phủ trước khi xuất.
- không thêm được cảnh tuỳ chỉnh vào video và hiện thông báo **Để dựng cảnh thành video, hãy bật tiêu đề hoạt hình ở phần bên dưới trước.** hoặc **Bật tiêu đề động trước.**: cuộn xuống mục **Tiêu đề động**, bật tính năng này và bấm **Tải về** để ứng dụng tải gói dựng hình một lần về máy.
- cảnh trong danh sách hiện cảnh báo **Cảnh này được dựng cho khổ khác; hãy dựng lại cho khổ hiện tại.**: sau khi đổi **Khổ hình** (ví dụ từ **9:16 dọc** sang **16:9 ngang**), hãy mở lại cảnh đó trong mục **Cảnh HTML tuỳ chỉnh** và bấm **Thêm làm shot** lại để tránh bị cắt mất nội dung.
- mẫu **Logo xuất hiện** báo **Thêm logo ở mục Logo trước.** hoặc **Logo lớn hơn 20 MB.**: bấm **Thêm logo (PNG)** ở cột bên trái và chọn một tệp ảnh nhỏ hơn 20 MB trước khi tạo tiêu đề.
- tính năng **Viết bằng AI** báo chưa bật nhà cung cấp LLM: mở **Cài đặt**, thiết lập một nhà cung cấp LLM cục bộ hoặc trực tuyến rồi quay lại bấm **Kiểm tra lại**.

## Bài liên quan

- [Lồng tiếng video](../long-tieng-video/)
- [Trình dựng video](../trinh-dung-video/)
- [Studio âm nhạc](../studio-am-nhac/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Cài đặt](../cai-dat/)
