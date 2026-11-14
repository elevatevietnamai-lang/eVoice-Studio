---
title: Thiết kế giọng bằng mô tả
description: Tạo giọng nói mới từ mô tả văn bản hoặc điểm khởi đầu có sẵn, nghe thử, tinh chỉnh chi tiết và lưu thành hồ sơ giọng trên máy.
slug: thiet-ke-giong
order: 4
group: voice
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

**Thiết kế giọng** giúp bạn tạo ra một giọng đọc mới chỉ bằng vài từ mô tả hoặc các mẫu tính cách có sẵn mà không cần file âm thanh mẫu. Model sẽ tự tổng hợp giọng phù hợp ngay trên máy của bạn và cho phép lưu lại để dùng lâu dài.

## Cần chuẩn bị

- Một engine hỗ trợ thiết kế giọng đã cài đặt và báo trạng thái **Thiết bị cục bộ: Engine sẵn sàng** (ví dụ nhóm OmniVoice, Qwen3-TTS VoiceDesign, VoxCPM2 hoặc audio.cpp).
- Đoạn nội dung bạn muốn giọng mới đọc thử để kiểm tra âm sắc.

## Các bước

### 1. Viết mô tả giọng hoặc chọn tính cách có sẵn

![Trang Thiết kế giọng trong eVoice Studio](shots/mo-trang.png)

Bấm vào mục **Giọng nói** trên thanh điều hướng bên trái, sau đó chọn thẻ **Thiết kế** ở thanh phía trên.

Nhập đặc điểm giọng bạn muốn vào ô **Mô tả giọng nói** (bằng tiếng Anh, tiếng Trung hoặc kết hợp cả hai, ngăn cách bằng dấu phẩy như giới tính, độ tuổi, cao độ, phong cách **Thì thầm**, giọng vùng miền).

Chọn một gợi ý trong mục **Điểm khởi đầu** như **Đĩnh đạc**, **Trẻ nhỏ hào hứng**, **Thì thầm**, **Ngạc nhiên**, **Người cao tuổi** hoặc **四川话** nếu bạn muốn điền nhanh thuộc tính mẫu. Cả hai cách đều tự điền các thuộc tính tương ứng vào mục **Chi tiết** bên dưới.

### 2. Tạo bản nghe thử

Nhập nội dung cần đọc vào khung **Văn bản** ở vùng làm việc chính, hoặc bấm mở mục **Nghe demo** để lấy đoạn văn mẫu.

Chọn ngôn ngữ ở nút **Ngôn ngữ** (mặc định là **Tự động**), mức chất lượng tại nút **Chất lượng âm thanh: Tiêu chuẩn** hoặc bấm **Điều chỉnh giọng nói** ở thanh dưới cùng nếu cần chỉnh thêm thông số đầu ra.

Bấm **Tổng hợp âm thanh** để máy tạo bản nghe thử và bấm **Phát** khi hoàn tất để kiểm tra giọng đọc.

### 3. Chỉnh mô tả và chi tiết giọng

Nhập thêm hoặc sửa lại từ khóa trong ô **Mô tả giọng nói** nếu giọng tạo ra chưa đúng ý.

Bấm mở mục **Chi tiết** ở cột bên trái để chọn từng thuộc tính theo nhóm (giới tính, độ tuổi, cao độ, phong cách, giọng tiếng Anh hoặc phương ngữ tiếng Trung), hoặc đổi số seed để tạo màu giọng khác từ cùng một mô tả. Trong mỗi nhóm thuộc tính, bạn chỉ chọn được một giá trị tại một thời điểm.

Bấm **Tổng hợp âm thanh** lần nữa để nghe lại bản thu mới sau khi chỉnh.

### 4. Lưu thành hồ sơ giọng

Nhập tên bạn muốn đặt vào ô **Tên hồ sơ** ở cuối cột bên trái.

Bấm **Lưu thành hồ sơ giọng** để lưu lại cấu hình thuộc tính và seed của giọng vừa tạo. Giọng đã lưu sẽ xuất hiện trong mục **Giọng đã lưu** (bạn có thể bấm **Xem trước giọng nói** hoặc **Sửa hồ sơ giọng: Người Kể Chuyện** trên từng mục, hoặc chuyển sang thẻ **Giọng đã lưu** để quản lý).

## Mẹo

- Với nhóm engine OmniVoice, ứng dụng tự ánh xạ câu mô tả của bạn sang bộ nhãn chuẩn (như giới tính, độ tuổi, cao độ). Với các engine nhận mô tả tự do như Qwen3-TTS VoiceDesign, VoxCPM2 hay audio.cpp, toàn bộ câu bạn viết trong **Mô tả giọng nói** được gửi thẳng tới model kèm theo các mục bạn chọn thêm trong **Chi tiết**.
- Bạn chỉ cần ghi những thuộc tính mình quan tâm; các thuộc tính bỏ trống sẽ được để ở mức **Tự động** để model tự quyết định.
- Lưu hồ sơ không bắt buộc tải hay nạp engine ngay lúc đó. Nếu engine đang nạp sẵn, ứng dụng sẽ tạo luôn mẫu âm thanh nhận diện; nếu chưa, mẫu âm thanh sẽ được tạo khi bạn bấm **Xem trước giọng nói**.
- Giọng vùng miền tiếng Anh chỉ có tác dụng khi văn bản đọc bằng tiếng Anh, và phương ngữ tiếng Trung (như **四川话**) chỉ áp dụng khi văn bản đọc bằng tiếng Trung.

## Lỗi thường gặp

- Không bấm được nút **Tổng hợp âm thanh** và xuất hiện thông báo engine không hỗ trợ thiết kế: Một số engine (như IndexTTS2, MOSS-TTS v1.5, MOSS-TTS-Nano, dots.tts, Confucius4, GPT-SoVITS, Supertonic-3, OmniVoice GGUF) chỉ nhân bản từ mẫu thu âm có sẵn chứ không tạo giọng mới từ mô tả. Hãy chuyển sang engine hỗ trợ thiết kế giọng trong phần cài đặt model.
- Giọng đọc nghe khác đi sau khi sửa mô tả của giọng đã lưu: Khi bạn chọn một giọng trong **Giọng đã lưu**, ứng dụng dùng lại mẫu âm thanh đã lưu để giữ chất giọng cố định. Ngay khi bạn đổi nội dung **Mô tả giọng nói**, thuộc tính trong **Chi tiết** hoặc số seed, bản nháp sẽ tách thành một thiết kế mới chưa lưu.
- Báo lỗi **Không lưu được hồ sơ giọng nói**: Kiểm tra xem bạn đã điền **Tên hồ sơ** chưa và chờ quá trình phân tích mô tả hoặc tổng hợp âm thanh hoàn tất rồi bấm **Lưu thành hồ sơ giọng** lại.

## Bài liên quan

- [Bắt đầu với eVoice Studio](../bat-dau/)
- [Nhân bản giọng](../nhan-ban-giong/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Thư viện giọng](../thu-vien-giong/)
- [Truyện nhiều giọng](../truyen/)
