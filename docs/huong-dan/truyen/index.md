---
title: Truyện nhiều giọng
description: Hướng dẫn tạo truyện nhiều giọng trên eVoice Studio: nhập kịch bản, tự phân vai, gán giọng cho từng nhân vật, nghe thử từng dòng và xuất file âm thanh.
slug: truyen
order: 8
group: stories
updated: 2026-11-15
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Truyện** giúp bạn biên tập kịch bản hội thoại hoặc truyện dài thành sách nói nhiều track với giọng đọc riêng cho từng nhân vật. Toàn bộ quá trình phân tách lời thoại, tổng hợp âm thanh và ghép chương đều chạy cục bộ trên máy của bạn. Bạn có thể nghe thử từng dòng, điều chỉnh tốc độ hoặc sắc thái riêng rồi xuất ra file hoàn chỉnh hay tải từng bản âm thanh theo nhân vật.

## Cần chuẩn bị

- Ít nhất một hồ sơ giọng đã tạo trong **Nhân bản giọng** hoặc **Thiết kế giọng**.
- Văn bản truyện hoặc kịch bản cần đọc (dán trực tiếp hoặc dùng file `.txt`, `.md`, `.srt`, `.vtt`, `.epub`, `.pdf`).
- Engine tổng hợp giọng ở trạng thái sẵn sàng trên thiết bị cục bộ.

## Các bước

### 1. Mở trang Truyện và nhập nội dung

Bấm **Truyện** trên thanh điều hướng bên trái để mở không gian biên tập.

![Giao diện trang Truyện trong eVoice Studio](shots/mo-trang.png)

Nhập tên cho tác phẩm vào ô **Tiêu đề** ở bảng bên trái. Tại vùng **Kịch bản**, thực hiện một trong các cách sau để đưa nội dung vào:

- Bấm **Nhập** để chọn file `.txt`, `.md`, `.srt`, `.vtt`, `.epub` hoặc `.pdf` từ máy tính.
- Bấm **Tải mẫu** nếu bạn muốn thử ngay bằng kịch bản mẫu có sẵn, hoặc bấm **Thêm dòng đầu tiên** để tự gõ từng câu thoại.
- Mở mục **Dán & tách**, dán đoạn văn dài vào ô văn bản, chọn kiểu **Tách theo** (**Đoạn văn**, **Câu** hoặc **Chương**), chỉnh **Ký tự tối đa mỗi đoạn** nếu tách theo câu, rồi bấm **Tách thành dòng**.

### 2. Tự phân vai từ kịch bản

Mở mục **Tự phân vai** phía trên vùng kịch bản khi bạn có sẵn văn bản hội thoại hoặc kịch bản phân vai.

Dán văn bản hoặc dùng nội dung vừa đưa vào từ bước **Nhập**, sau đó chạy **Tự phân vai**. Bộ phân tích cục bộ trên máy sẽ tự tách các dòng thoại, nhận diện tên người nói, thêm vào **Dàn nhân vật** và gán các hồ sơ giọng hiện có cho nhân vật mới mà không cần kết nối mạng.

### 3. Gán giọng cho từng nhân vật

Chọn một hồ sơ trong mục **giọng nói** ở cột bên trái để làm giọng đọc mặc định cho toàn bộ truyện.

Mở thẻ **Dàn nhân vật — gán giọng cho từng nhân vật** ở cột bên trái để quản lý giọng theo vai:

- Bấm **Thêm nhân vật**, nhập **Tên nhân vật** và chọn giọng tương ứng cho từng vai.
- Chọn nhân vật hoặc giọng riêng trên từng dòng thoại trong vùng **Kịch bản** nếu muốn ghi đè giọng **Mặc định**.
- Bôi đen một cụm từ trong dòng rồi bấm **Đặt giọng giữa câu** khi cần đổi giọng ngay trong cùng một câu, hoặc bấm **Khôi phục giọng của dòng** để quay về giọng ban đầu.

### 4. Tinh chỉnh và nghe thử từng đoạn

Chỉnh thanh trượt **Tốc độ** ở cột bên trái để đặt tốc độ đọc chung cho các dòng chưa đặt tốc độ riêng. Nếu nhiều dòng đang dùng tốc độ riêng và bạn muốn đồng bộ lại, bấm **Dùng cho mọi dòng**.

Trên từng dòng thoại trong **Kịch bản**, bạn có thể:

- Bấm **Chèn khoảng ngắt [pause 0.5s]** hoặc gõ trực tiếp cú pháp `[pause 0.5s]` vào văn bản để tạo khoảng lặng.
- Mở **Sắc thái & tốc độ** của dòng để chỉnh tốc độ riêng hoặc chọn sắc thái như **Cười**, **Thở dài**, **Câu hỏi**, **Bất ngờ**, **Xác nhận**, **Hừm** khi engine đang dùng hỗ trợ biểu cảm.
- Bấm **Chuyển lên**, **Chuyển xuống** để đổi thứ tự dòng, **Thêm dòng** hoặc **Thêm chương** để mở rộng cấu trúc truyện.
- Bấm **Xem trước dòng này** để nghe thử ngay đoạn thoại đó trước khi tạo toàn bộ truyện.

### 5. Tạo truyện hoàn chỉnh

Chọn **Ngôn ngữ** đầu ra và chọn **Định dạng** xuất là **M4B (chương)** hoặc **MP3** ở bảng bên trái. Bạn cũng có thể mở **Tùy chỉnh đọc** để chỉnh thông số tổng hợp nâng cao và mở **Bìa & chi tiết** để thêm ảnh bìa hoặc thông tin sách.

Bấm **Tạo** ở cuối bảng bên trái để bắt đầu tổng hợp âm thanh. Trong lúc máy đang xử lý từng chương, bạn có thể bấm **Dừng** bất cứ lúc nào; nếu quá trình bị gián đoạn, bấm **Tiếp tục** trong mục khôi phục để chạy tiếp các chương còn lại từ bộ nhớ đệm mà không phải tạo lại từ đầu.

### 6. Nghe lại và xuất file

Nghe lại thành phẩm ngay trên trình phát âm thanh xuất hiện ở cuối trang sau khi tạo xong, rồi bấm nút tải xuống để lưu file `.m4b` hoặc `.mp3` về máy.

Mở thêm mục **Bản âm thanh theo nhân vật** ở cuối vùng kịch bản nếu bạn muốn kết xuất và tải riêng từng file WAV cho mỗi nhân vật để hậu kỳ ngoài. Để lưu lại toàn bộ kịch bản và thiết lập cho lần làm việc sau, chuyển sang tab **Dự án** ở đầu bảng bên trái và bấm **Lưu**.

## Mẹo

- Dùng định dạng **M4B (chương)** khi truyện có nhiều chương để trình phát sách nói nhận diện được mục lục chương tự động; bạn cũng có thể tải kèm file mốc thời gian chương dạng `.txt` sau khi tạo xong.
- Khi mọi dòng thoại trong kịch bản đều đã được gán giọng qua nhân vật hoặc giọng riêng của dòng, bạn có thể bấm **Tạo** ngay cả khi chưa chọn giọng mặc định.
- Bấm **Xóa kịch bản** ở góc trên bên phải khi muốn làm trống toàn bộ các dòng và chương để viết tập mới mà vẫn giữ nguyên **Dàn nhân vật** đã thiết lập.

## Lỗi thường gặp

- nút **Tạo** bị khóa và báo chưa có hồ sơ giọng: bạn thấy thông báo **Chưa có hồ sơ giọng nào — nhân bản giọng hoặc thiết kế giọng trước.** Hãy mở trang nhân bản hoặc thiết kế giọng để lưu ít nhất một giọng trước khi quay lại **Truyện**.
- không dùng được tính năng tự phân vai: ứng dụng báo **Chưa có gì để tự phân vai — dán hoặc nhập truyện trước.** Hãy dán nội dung hoặc bấm **Nhập** để tải văn bản vào trước khi chạy **Tự phân vai**.
- không tạo được âm thanh do giọng đã bị xóa: nếu một nhân vật hoặc dòng thoại đang gắn với hồ sơ giọng đã bị xóa khỏi máy, nút **Tạo** sẽ bị chặn để tránh đổi giọng ngoài ý muốn. Hãy mở **Dàn nhân vật — gán giọng cho từng nhân vật** hoặc dòng thoại đó để chọn lại giọng khác hoặc chuyển về **Mặc định**.
- không đọc được file khi nhập: khi gặp thông báo **Không đọc được tệp này. Thử chọn tệp khác.**, hãy kiểm tra lại định dạng file (`.txt`, `.md`, `.srt`, `.vtt`, `.epub`, `.pdf`) và đảm bảo file không bị lỗi cấu trúc.
- tải về file WAV thay vì MP3 hoặc xuất thất bại: nếu hiện thông báo **Không mã hóa được MP3 — đã tải về WAV thay thế.** hoặc **Xuất thất bại — kiểm tra xem máy chủ nền có đang chạy không.**, hãy kiểm tra trạng thái engine ở thanh dưới cùng và thử xuất lại.

## Bài liên quan

- [Sách nói](../sach-noi/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Thiết kế giọng bằng mô tả](../thiet-ke-giong/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Dự án](../du-an/)
