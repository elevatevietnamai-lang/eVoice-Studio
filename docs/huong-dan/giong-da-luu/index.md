---
title: Quản lý giọng đã lưu
description: Hướng dẫn xem danh sách, nghe thử, sửa tên và ảnh đại diện, thay mẫu giọng nói hoặc xóa các giọng đã lưu trong eVoice Studio.
slug: giong-da-luu
order: 3
group: voice
updated: 2026-11-15
app_version: 0.5.7-beta.3
status: approved
---

## Tính năng này làm gì

Trang **Giọng đã lưu** là nơi tập trung toàn bộ hồ sơ giọng bạn đã tạo từ tính năng nhân bản hoặc thiết kế giọng trên máy. Tại đây, bạn có thể tìm kiếm, nghe thử, đổi tên, cập nhật ảnh đại diện, thay mẫu âm thanh gốc hoặc xóa những giọng không còn dùng.

## Cần chuẩn bị

- Ít nhất một hồ sơ giọng đã tạo trong **Nhân bản giọng** hoặc **Thiết kế**, hoặc giọng đã lưu về từ **Thư viện**.
- Ảnh định dạng PNG, JPG hoặc WebP (tối đa 5 MB, độ phân giải không quá 16 megapixel) nếu bạn muốn đổi ảnh đại diện cho giọng.
- Tệp âm thanh mẫu mới (WAV, MP3, M4A, FLAC, OGG, Opus, AAC hoặc WebM, tối đa 128 MiB) và FFmpeg hoặc libsndfile trên máy nếu bạn muốn thay mẫu giọng nhân bản.

## Các bước

### 1. Mở danh sách giọng đã lưu

Bấm **Giọng nói** trên thanh điều hướng bên trái để mở trang **Giọng đã lưu**.

![Danh sách các giọng đã lưu trong eVoice Studio](shots/mo-trang.png)

Nhập từ khóa vào ô **Tìm kiếm…** để lọc nhanh theo tên giọng. Chọn **Tất cả** hoặc các nút lọc bên cạnh để xem toàn bộ danh sách, chỉ xem giọng nhân bản hoặc chỉ xem giọng thiết kế. Nếu muốn tạo giọng mới ngay từ trang này, bấm **Nhân bản giọng** hoặc **Thiết kế** ở góc trên bên trái.

### 2. Nghe thử, sửa tên và ảnh đại diện

Bấm **Xem trước giọng nói** trên dòng của một giọng để nghe thử mẫu âm thanh đã lưu.

Bấm **Sửa hồ sơ giọng** trên giọng bạn muốn chỉnh sửa để mở khung biên tập bên phải.

Nhập tên mới cho hồ sơ hoặc cập nhật nội dung phiên âm và phong cách của giọng. Nếu không dùng ảnh riêng, ứng dụng tự tạo ảnh chữ cái đầu từ từ đầu tiên và từ cuối cùng trong tên giọng.

Bấm **Đổi ảnh** hoặc thao tác tại vùng **Nhấp hoặc thả ảnh vào. PNG, JPG hoặc WebP tối đa 5 MB.** để tải ảnh đại diện từ máy lên; ảnh sẽ được cắt về kích thước 256 × 256 và xóa siêu dữ liệu gốc khi lưu trên máy. Bấm **Xóa ảnh** để quay về chữ cái đầu.


Bấm **Lưu** để áp dụng các thay đổi, hoặc bấm **Đóng** để đóng khung chỉnh sửa.

### 3. Thay audio mẫu

Chọn **Sửa hồ sơ giọng** trên một giọng nhân bản cần đổi tệp âm thanh gốc.

Bấm **Thay mẫu tham chiếu** trong khung chỉnh sửa rồi chọn tệp âm thanh mới hoặc thu âm trực tiếp (WAV, MP3, M4A, FLAC, OGG, Opus, AAC hoặc WebM). Khi chọn tệp mới, ô phiên âm được xóa trống; bạn có thể tự nhập lời thoại hoặc để trống để app tự chép lời clip mới. Nếu đổi ý, bấm **Giữ mẫu tham chiếu hiện tại**.


Bấm **Lưu** để cập nhật mẫu âm thanh vào cùng hồ sơ mà không làm mất lịch sử hay tên giọng. Lưu ý rằng việc thay mẫu âm thanh mới sẽ xóa bản thu đã khóa và trạng thái xác minh giọng chính chủ trước đó của hồ sơ này. Các giọng tạo từ **Thiết kế** được chỉnh sửa bằng công thức mô tả thay vì thay tệp âm thanh mẫu.

### 4. Xuất và nhập giọng

Để xuất, mở **Sửa hồ sơ giọng** trên giọng cần chia sẻ rồi bấm **Xuất hồ sơ giọng**. Bật **Kèm clip giọng** nếu muốn gửi kèm clip tham chiếu gốc; để tắt (khuyên dùng) thì gói chỉ chứa bản nghe thử có dấu bản quyền âm thanh.

Để nhập, mở **Thư viện**, chọn mục **Đã nhập** rồi bấm **Nhập gói giọng mẫu .ovsvoice** và chọn tệp (tối đa 100 MB). Giọng nhập vào xuất hiện trong danh sách **Giọng đã lưu**. Nếu bạn đã thay mẫu âm thanh của một giọng tải từ **Thư viện**, khi nhập lại giọng đó app tạo một hồ sơ riêng, không ghi đè bản bạn đã sửa.

### 5. Xóa giọng

Bấm **Xóa giọng** trên dòng hồ sơ bạn không còn sử dụng và bấm **Xác nhận** khi được hỏi.

Ứng dụng sẽ xóa hồ sơ trong cơ sở dữ liệu trước, sau đó dọn dẹp tệp âm thanh mẫu, bản thu đã khóa, bản ghi xác nhận và ảnh đại diện trên ổ cứng. Nếu giọng vừa xóa đang được chọn trong khung làm việc, lựa chọn đó cũng được tự động gỡ bỏ.

## Mẹo

- Bấm trực tiếp vào một dòng trong danh sách chỉ chọn giọng đó để dùng; bấm **Sửa hồ sơ giọng** giúp bạn chỉnh sửa thông tin mà không làm đổi giọng đang chọn ở khung làm việc.
- Khi thay mẫu âm thanh cho một giọng nhân bản, bộ nhớ đệm của engine và các chương sách nói dùng giọng đó sẽ tự động được làm mới theo tệp âm thanh mới.
- Nếu máy chưa cài model đọc chính tả khi bạn thay mẫu âm thanh, bạn vẫn có thể tự gõ nội dung lời thoại mẫu vào ô phiên âm trước khi bấm **Lưu**.

## Lỗi thường gặp

- không tải lên được ảnh đại diện: kiểm tra lại định dạng ảnh phải là PNG, JPG hoặc WebP, dung lượng không vượt quá 5 MB và độ phân giải tối đa 16 megapixel.
- không thay được tệp âm thanh mẫu và báo lỗi giải mã: đảm bảo tệp thuộc định dạng được hỗ trợ (WAV, MP3, M4A, FLAC, OGG, Opus, AAC, WebM dưới 128 MiB) và máy đã có FFmpeg hoặc libsndfile để đọc dữ liệu âm thanh.
- không tìm thấy tùy chọn thay tệp âm thanh mẫu: kiểm tra xem hồ sơ đó có phải là giọng tạo từ **Thiết kế** hay không, vì giọng thiết kế chỉnh sửa qua công thức mô tả chứ không dùng tệp âm thanh mẫu.
- xuất hiện thông báo dọn dẹp tệp chưa hoàn tất sau khi bấm **Xóa giọng**: hồ sơ giọng đã được xóa khỏi danh sách nhưng một số tệp âm thanh hoặc ảnh trong thư mục chứa giọng chưa xóa được ngay; bạn có thể kiểm tra đường dẫn tương đối trong thông báo hoặc nhật ký backend cục bộ để xóa thủ công các tệp còn sót.

## Bài liên quan

- [Nhân bản giọng](../nhan-ban-giong/)
- [Thiết kế giọng bằng mô tả](../thiet-ke-giong/)
- [Thư viện giọng](../thu-vien-giong/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
