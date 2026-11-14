---
title: Công cụ: so sánh và chuyển giọng
description: Cách dùng trang Công cụ trong eVoice Studio để so sánh hai giọng nói A/B, chuyển giọng file audio và chạy các tiện ích âm thanh cục bộ.
slug: cong-cu
order: 13
group: more
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Công cụ** tập hợp các tiện ích xử lý âm thanh, chuyển đổi định dạng và kiểm tra nhanh trên một màn hình. Tại đây, bạn có thể nghe đối chiếu hai giọng đọc trên cùng một câu thử, chuyển giọng một file audio có sẵn sang hồ sơ giọng đã lưu, hoặc kiểm tra chỉ dẫn đạo diễn, độ khớp tốc độ nói và thông số kỹ thuật của tệp. Mọi thao tác đều chạy cục bộ trên máy của bạn.

## Cần chuẩn bị

- Một model đọc văn bản (TTS) đã tải sẵn và hỗ trợ nhân bản giọng khi dùng tính năng so sánh hoặc chuyển đổi giọng.
- Ít nhất một hồ sơ giọng đã tạo (từ tính năng nhân bản giọng hoặc thiết kế giọng) nếu bạn muốn chuyển giọng cho file audio.
- Một file âm thanh nguồn (định dạng WAV, MP3, M4A…) hoặc đường dẫn tệp trên máy để dùng với các tiện ích tương ứng.

## Các bước

### 1. Mở trang Công cụ

1. Bấm biểu tượng **Công cụ** (hình cờ lê) ở thanh điều hướng bên trái, hoặc bấm ô **Tìm kiếm…** (`Ctrl K`) ở thanh trên cùng để mở trang `/tools`.
2. Chọn công cụ bạn cần dùng trong danh sách bên trái gồm: **AI đạo diễn**, **Khớp tốc độ nói**, **Kiểm tra tệp**, **So sánh giọng nói A/B** và **Chuyển đổi**.

![Giao diện trang Công cụ với danh sách các tiện ích ở cột bên trái và khung AI đạo diễn ở bên phải](shots/mo-trang.png)

### 2. So sánh hai giọng

1. Bấm **So sánh giọng nói A/B** ở cột bên trái.
2. Nhập câu văn bạn muốn nghe đối chiếu vào ô **Câu thử**.
3. Chọn giọng thứ nhất tại mục **Giọng nói A** và giọng thứ hai tại mục **Giọng nói B** (thay cho giá trị mặc định **— Chọn giọng nói —**; bạn có thể chọn giọng đã lưu hoặc giọng có nhãn **(Mẫu sẵn)**).
4. Bấm **So sánh** để bắt đầu tạo âm thanh. Trạng thái sẽ lần lượt hiển thị **Đang so sánh…**, **Đang chuẩn bị giọng nói...**, **Đang tạo Giọng nói A...**, **Đang tạo Giọng nói B...** và kết thúc bằng **So sánh hoàn tất!**.
5. Bấm **Phát** ở từng khung để nghe thử và đối chiếu hai bản thu, hoặc bấm **Đóng so sánh** khi hoàn tất.

### 3. Chuyển giọng một file audio sang giọng đã lưu

1. Bấm **Chuyển đổi** ở cột bên trái.
2. Kéo thả file âm thanh vào khung **Clip nguồn** có dòng chữ **Thả clip cần chuyển đổi vào đây — hoặc nhấp. WAV, MP3, M4A…**, hoặc bấm vào khung để chọn file từ máy.
3. Chọn giọng bạn muốn áp dụng tại mục **Giọng đích** (ô **Chọn hồ sơ giọng nói…** hỗ trợ cả giọng nhân bản lẫn giọng thiết kế đã lưu).
4. Chọn **Khớp thời lượng nguồn** nếu bạn muốn độ dài bản thu mới khớp với thời lượng của clip gốc.
5. Bấm **Chuyển đổi**. Hệ thống hiển thị trạng thái **Đang chuyển đổi…**, tự động nhận diện lời nói trong clip gốc và đọc lại bằng giọng đích.
6. Kiểm tra phần văn bản nhận diện được tại mục **Nội dung nghe được** và nghe kết quả âm thanh tại mục **Bản thu đã chuyển đổi**.

### 4. Dùng các tiện ích audio khác

1. Chọn **AI đạo diễn**, nhập yêu cầu diễn cảm bằng ngôn ngữ tự nhiên vào ô **Chỉ dẫn**, rồi bấm **Phân tích**. Khung **kết quả:** sẽ hiển thị **phương pháp:**, **chỉ dẫn TTS:**, **gợi ý dịch:**, **độ lệch tốc độ:** cùng hai mục chi tiết có thể mở rộng là **thẻ** và **phân loại**.
2. Chọn **Khớp tốc độ nói** để kiểm tra câu dịch có vừa với khoảng thời gian cho phép hay không: nhập câu thoại vào ô **Câu đã dịch**, nhập số giây dương vào ô **Thời lượng (giây)**, chọn **Ngôn ngữ đích**, rồi bấm **Kiểm tra độ khớp** để xem **phương pháp:**, **tỷ lệ:**, **số lần thử:** và **kết quả:**.
3. Chọn **Kiểm tra tệp** để xem thông tin codec, luồng, độ sâu bit và thời lượng qua ffprobe: nhập đường dẫn đầy đủ của file trên máy vào ô **Đường dẫn tuyệt đối**, rồi bấm **Kiểm tra**.

## Mẹo

- Tùy chọn **Khớp thời lượng nguồn** trong mục **Chuyển đổi** chỉ co giãn tổng thời lượng của bản thu đầu ra cho khớp với clip gốc, không giữ nguyên cao độ, nhịp nghỉ hay biểu cảm của giọng gốc.
- Khi bạn chuyển sang một công cụ khác ở cột bên trái trong lúc yêu cầu cũ đang hiển thị **Đang tải…**, ứng dụng sẽ tự hủy yêu cầu trước đó để kết quả cũ không ghi đè lên màn hình mới.
- Trong mục **Chuyển đổi**, bạn có thể gõ tên hồ sơ vào ô **Chọn hồ sơ giọng nói…** để lọc nhanh giữa các giọng nhân bản và giọng thiết kế đã lưu.

## Lỗi thường gặp

- Cảnh báo **Thêm clip nguồn và chọn giọng đích trước.**: Bạn đã bấm **Chuyển đổi** khi chưa tải file vào **Clip nguồn** hoặc chưa chọn giọng trong **Giọng đích**. Hãy hoàn tất cả hai mục rồi thử lại.
- Cảnh báo **Chọn một mô hình đọc văn bản đã sẵn sàng và hỗ trợ nhân bản giọng.**: Tính năng so sánh và chuyển đổi giọng cần một engine TTS hỗ trợ nhân bản giọng đã tải sẵn trên máy. Hãy kiểm tra và tải model phù hợp trước khi chạy.
- Nút **Kiểm tra độ khớp** không bấm được: Kiểm tra lại ô **Câu đã dịch** xem đã có nội dung chưa và ô **Thời lượng (giây)** phải là một số lớn hơn `0`.
- Lỗi khi chạy **Kiểm tra tệp**: Đảm bảo đường dẫn nhập vào ô **Đường dẫn tuyệt đối** là đường dẫn đầy đủ, chính xác tới file trên máy và công cụ ffprobe đã được cài đặt trong phần cài đặt công cụ âm thanh.

## Bài liên quan

- [Nhân bản giọng](../nhan-ban-giong/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Thiết kế giọng bằng mô tả](../thiet-ke-giong/)
- [Lồng tiếng video](../long-tieng-video/)
- [Cài đặt](../cai-dat/)
