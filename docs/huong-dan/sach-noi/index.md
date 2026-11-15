---
title: Sách nói
description: Tạo sách nói có phân chương từ văn bản, tùy chỉnh giọng đọc và xuất file M4B hoặc MP3 ngay trên máy với eVoice Studio.
slug: sach-noi
order: 9
group: stories
updated: 2026-11-15
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Sách nói** biến bản thảo hoặc tài liệu dài thành sách nói hoàn chỉnh có phân chia chương rõ ràng. Bạn có thể gán giọng đọc cho người kể chuyện và từng vai trong truyện, nghe thử từng chương trước khi tổng hợp toàn bộ, rồi theo dõi chữ chạy theo âm thanh sau khi tạo xong. Mọi quá trình xử lý đều chạy cục bộ trên máy của bạn mà không cần gửi văn bản lên mạng.

## Cần chuẩn bị

- Ít nhất một giọng đọc đã tạo hoặc lưu sẵn trong mục **Giọng nói**.
- Trạng thái dưới góc trái hiển thị **Thiết bị cục bộ: Engine sẵn sàng**.
- Bản thảo sách dạng văn bản hoặc file tài liệu (`.txt`, `.md`, `.epub`, `.pdf`) để nhập vào ứng dụng.

## Các bước

### 1. Nhập sách

![Trang Sách nói trong eVoice Studio](shots/mo-trang.png)

- Chọn **Truyện** ở thanh điều hướng bên trái, sau đó bấm **Sách nói** trên thanh tiêu đề nếu bạn đang ở giao diện truyện nhiều giọng.
- Nhập tên tác phẩm vào ô **Tiêu đề** ở khung bên trái.
- Gõ hoặc dán nội dung trực tiếp vào vùng **Kịch bản** ở khung chính.
- Bấm **Nhập** ở góc trên bên phải khung **Kịch bản** nếu bạn muốn tải nội dung từ file `.txt`, `.md`, `.epub` hoặc `.pdf` trên máy.
- Bấm **Tải mẫu** khi khung soạn thảo đang trống để chèn nhanh một kịch bản mẫu và làm quen với định dạng.
- Bấm **Xóa kịch bản** nếu bạn muốn xóa toàn bộ nội dung hiện tại để làm lại từ đầu.

### 2. Đánh dấu chương và chèn thẻ đọc

- Bắt đầu một dòng mới bằng ký hiệu `# ` kèm tên chương (ví dụ: `# Chương một`) để đánh dấu mốc chương mới trong sách nói.
- Đặt con trỏ tại vị trí cần điều chỉnh trong **Kịch bản**, sau đó bấm các nút trên thanh công cụ phía trên vùng soạn thảo để chèn nhanh thẻ điều khiển:
  - Bấm **Tạm dừng** để thêm khoảng nghỉ (ví dụ: `[pause 500ms]`).
  - Bấm **Giọng** để chèn thẻ đổi người đọc (ví dụ: `[voice:narrator]`).
  - Bấm **Chậm**, **Nhanh** hoặc **Nhấn mạnh** để điều chỉnh nhịp độ và trọng âm cho đoạn văn bản.
  - Bấm **Đánh vần** hoặc **Phản ứng** để chèn thẻ đọc từng chữ cái hoặc biểu cảm tương ứng.

### 3. Cài đặt giọng đọc và thông tin sách

- Chọn giọng đọc chính cho toàn bộ sách trong danh sách **giọng nói** ở cột bên trái.
- Chọn ngôn ngữ đầu ra tại mục **Ngôn ngữ** (hoặc để **Tự động**).
- Chọn **M4B (chương)** hoặc **MP3** tại mục **Định dạng**. Định dạng **M4B (chương)** lưu kèm danh sách mốc chương bên trong file âm thanh.
- Mở mục **Dàn giọng** để gán từng tên thẻ `[voice:NAME]` có trong kịch bản vào một giọng đọc đã lưu.
- Mở mục **Tùy chỉnh đọc** nếu bạn muốn chỉnh sâu các thông số tổng hợp như **Số bước**, **CFG**, **Nhiệt độ vị trí**, **Đọc khác nhau cho dòng lặp**, **Khoảng nghỉ giữa các dòng**, **Khoảng nghỉ giữa các đoạn**, **Cắt khoảng lặng của engine**, hoặc chỉnh **Mô tả cảm xúc** và **Mức độ cảm xúc** khi dùng engine IndexTTS2.
- Mở mục **Bìa & chi tiết** để bấm **Thêm bìa** (ảnh JPEG hoặc PNG) và điền các thông tin gồm **Tác giả**, **Người kể chuyện**, **Năm**, **Thể loại**, **Mô tả**, hoặc thiết lập từ điển **Phát âm** bằng nút **Thêm từ** cho những từ cần cách đọc riêng.
- Mở mục **Âm lượng** để giữ **Âm lượng: tắt** hoặc chọn chuẩn hóa theo **Chuẩn hóa (ACX)** hay **Chuẩn hóa (podcast)**.

### 4. Tạo sách nói

- Mở mục **Xem trước kế hoạch** ở cột bên trái nếu bạn muốn kiểm tra cấu trúc các chương và nghe thử từng chương trước khi tạo toàn bộ sách.
- Bấm **Tạo sách nói** ở góc dưới bên trái để bắt đầu tổng hợp âm thanh.
- Bấm **Dừng** bất cứ lúc nào nếu bạn muốn tạm ngưng; các chương đã hoàn thành được lưu lại trong bộ nhớ đệm. Khi bạn bấm **Tạo sách nói** lại hoặc bấm **Tiếp tục** tại mục **Sách nói bị gián đoạn**, ứng dụng sẽ dùng lại các chương đã xong và chỉ tổng hợp phần còn lại.

### 5. Nghe với chữ chạy theo audio

- Khi quá trình tổng hợp hoàn tất, mục **Sách nói đã sẵn sàng** xuất hiện ở cuối khung bên phải.
- Bấm **Phát** trên trình phát âm thanh để nghe lại tác phẩm và dùng mục **Đọc theo** để theo dõi nội dung kịch bản chạy đồng bộ theo giọng đọc cũng như chuyển nhanh giữa các chương.

### 6. Xuất file và tạo clip audiogram

- Bấm **Tải xuống** ở góc phải mục **Sách nói đã sẵn sàng** để lưu file sách nói (`.m4b` hoặc `.mp3`) về máy.
- Bấm **Tải danh sách chương (.txt)** để lưu file văn bản ghi lại mốc thời gian và tiêu đề từng chương, tiện dùng cho mô tả podcast hoặc trình phát không đọc được mốc chương nhúng sẵn.
- Mở mục **Clip audiogram** bên dưới trình phát nếu bạn muốn trích một đoạn ngắn làm video đăng mạng xã hội: nhập thời điểm **Bắt đầu (m:ss)**, **Độ dài (giây)**, chọn **Khổ** (**Vuông**, **Ngang** hoặc **Dọc**), điền **Tiêu đề trên video** rồi bấm **Tạo video**.

## Mẹo

- Chuyển sang thẻ **Dự án** ở đầu cột bên trái để lưu lại toàn bộ kịch bản, dàn giọng và cài đặt hiện tại thành dự án riêng, giúp bạn dễ dàng quản lý nhiều đầu sách khác nhau.
- Nghe thử trong **Xem trước kế hoạch** dùng chung bộ nhớ đệm với lúc xuất thật; những chương bạn đã nghe thử và không chỉnh sửa lại sẽ được ghép ngay khi bấm **Tạo sách nói** mà không cần tổng hợp lại.
- Khi nhập file `.epub`, ứng dụng tự động nhận diện mục lục để tách chương và lược bỏ các trang phụ ở đầu sách như trang bìa hay trang bản quyền.

## Lỗi thường gặp

- Nút **Tạo sách nói** bị mờ và hiện dòng nhắc **Viết hoặc nhập kịch bản để tạo.**: vùng **Kịch bản** đang để trống hoặc chỉ có tiêu đề chương. Bạn hãy nhập nội dung văn bản cần đọc hoặc bấm **Tải mẫu**.
- Thông báo **Chọn giọng mặc định hoặc gán giọng cho từng dòng.**: bạn chưa chọn giọng trong danh sách **giọng nói** ở cột bên trái, hoặc có thẻ `[voice:NAME]` đang gán cho một giọng đã bị xóa. Hãy chọn một giọng mặc định và kiểm tra lại mục **Dàn giọng**.
- Thông báo **Một từ phát âm bị liệt kê hai lần. Xóa mục trùng để tạo.**: trong bảng **Phát âm** có hai dòng trùng cùng một từ. Bạn hãy mở phần **Phát âm** và bấm **Xóa** ở dòng bị trùng để mỗi từ chỉ giữ một cách đọc.
- Thông báo **Engine giọng nói chưa sẵn sàng. Kiểm tra Cài đặt → Engine.**: model giọng đọc chưa tải xong hoặc engine gặp sự cố. Bạn hãy mở **Cài đặt** để kiểm tra trạng thái engine trước khi tạo lại.
- Thông báo **Đang tạo một sách nói khác. Chờ hoàn tất hoặc dừng lại trước.**: đang có một tiến trình tạo sách nói hoặc truyện chạy nền. Bạn hãy chờ tiến trình đó xong hoặc bấm **Dừng** trước khi bắt đầu sách mới.

## Bài liên quan

- [Truyện nhiều giọng](../truyen/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Thiết kế giọng bằng mô tả](../thiet-ke-giong/)
- [Dự án](../du-an/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
