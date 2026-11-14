---
title: Quy trình tự động
description: Hướng dẫn tạo, kết nối các bước và chạy quy trình xử lý văn bản, âm thanh tự động ngay trên máy trong eVoice Studio.
slug: quy-trinh
order: 12
group: more
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

Trang **Quy trình** giúp bạn ghép nhiều bước xử lý văn bản và âm thanh thành một chuỗi tự động trên khung vẽ để chạy hàng loạt cho nhiều mục đầu vào cùng lúc. Bạn có thể kết hợp đọc văn bản, chép lời, dịch, đổi giọng, chuẩn hóa âm lượng hoặc rẽ nhánh theo điều kiện ngay trên máy. Các quy trình và kết quả chạy được lưu cục bộ để bạn tạm dừng, tiếp tục hoặc tải về khi cần.

## Cần chuẩn bị

- Kịch bản văn bản (tối đa 50 mục mỗi lần chạy, mỗi kịch bản tối đa 20.000 ký tự, ngăn cách bằng dòng `---` hoặc nhập từ tệp) hoặc các tệp âm thanh đầu vào (tối đa 64 MiB mỗi tệp).
- Hồ sơ giọng nói đã tạo sẵn nếu quy trình có dùng bước **Nói** hoặc **Chuyển đổi**.
- Các model tương ứng đã sẵn sàng trên máy cho những bước bạn sử dụng như **Chép lời**, **Dịch**, **Nói** hoặc **Chuyển đổi**.

## Các bước

### 1. Tạo quy trình

![Giao diện trang Quy trình trong eVoice Studio](shots/mo-trang.png)

- Bấm biểu tượng **Thêm** ở thanh điều hướng bên trái để mở trang **Quy trình**.
- Bấm nút dấu cộng (**Quy trình mới**) ở khung **Quy trình** bên trái để tạo quy trình trống, hoặc chọn một mẫu có sẵn trong mục **Mẫu** như **Thuyết minh hàng loạt**, **Thuyết minh hàng loạt · Chuẩn hóa âm thanh**, **Âm thanh thành bản chép lời**, **Đổi giọng nói**, **Dịch và thuyết minh**, **Đặt nhà hàng**, **Đổi lịch hẹn** hoặc **Hỏi giờ mở cửa**.
- Nhập tên dễ nhớ vào ô **Tên** ở thanh công cụ phía trên khung vẽ để thay cho tên mặc định **Quy trình chưa có tên**.
- Bấm **Tạo bản sao** nếu bạn muốn nhân bản quy trình hiện tại, hoặc bấm **Xóa** rồi chọn **Xóa** (hoặc **Hủy**) trong hộp thoại xác nhận khi muốn bỏ một quy trình không còn dùng.

### 2. Nối các bước

- Bấm vào các mục trong danh sách **Thêm bước** ở cột trái để đưa bước mới lên khung vẽ, gồm bước đầu vào (**Bắt đầu** cho văn bản hoặc **Clip nguồn** cho âm thanh), các bước xử lý (**Nói**, **Chuyển đổi**, **Chép lời**, **Dịch**, **Chuẩn hóa âm thanh**, **Điều kiện**) và bước đích **Kết thúc**.
- Kéo dây nối từ chấm tròn bên phải của bước trước sang chấm tròn bên trái của bước tiếp theo để tạo luồng xử lý. Với bước **Điều kiện**, nối cả hai cổng đầu ra **Có** (khi khớp điều kiện) và **Không** (khi không khớp) tới các nhánh tiếp theo.
- Bấm chọn từng bước trên khung vẽ để mở bảng **Chi tiết bước** ở bên phải, sau đó đặt **Tên bước** và cấu hình dữ liệu đầu vào, giọng đọc, ngôn ngữ hoặc mức âm lượng. Với bước **Điều kiện**, nhập cụm từ vào **Văn bản cần tìm** và chọn kiểu **Khớp** là **Chứa**, **Đúng bằng**, **Bắt đầu bằng** hoặc **Kết thúc bằng**.
- Bấm **Xóa bước** trong bảng **Chi tiết bước** hoặc nhấn phím `Delete` / `Backspace` trên bàn phím nếu muốn gỡ bước đang chọn khỏi khung vẽ.

### 3. Chạy

- Bấm **Chạy quy trình** ở góc trên bên phải khung vẽ để mở bảng chạy quy trình.
- Chọn bắt đầu chạy để ứng dụng kiểm tra tính tương thích giữa các bước và lần lượt xử lý từng mục theo thứ tự.
- Bấm **Dừng** bất cứ lúc nào nếu bạn muốn tạm ngắt quá trình; các bước đã hoàn tất được lưu lại làm điểm đánh dấu để lần chạy sau tiếp tục từ chỗ đang dở. Nếu có mục bị lỗi, quy trình sẽ dừng lại để bạn bấm **Thử lại**.

### 4. Xem kết quả

- Bấm **Phát** trên từng mục đã hoàn thành để nghe thử kết quả âm thanh hoặc xem văn bản đầu ra ngay trong bảng chạy quy trình.
- Bấm **Lưu** để mở hộp thoại lưu tệp của hệ thống và xuất kết quả về máy dưới dạng `.wav` (đối với âm thanh) hoặc `.txt` (đối với văn bản).

## Mẹo

- Dùng các nút **Zoom In**, **Zoom Out** và **Fit View** ở góc dưới bên trái khung vẽ để thu phóng hoặc căn chỉnh toàn bộ sơ đồ khi quy trình có nhiều bước.
- Ngăn cách nhiều đoạn kịch bản trong bước **Bắt đầu** bằng một dòng chỉ có `---` để chạy hàng loạt tới 50 mục trong một lần.
- Khi dùng bước **Điều kiện**, ứng dụng tự bỏ qua chữ hoa/thường và khoảng trắng thừa ở hai đầu chuỗi; bạn có thể cho một nhánh nối thẳng tới **Kết thúc** nếu muốn giữ nguyên văn bản của nhánh đó.
- Di chuyển vị trí các bước trên khung vẽ hoặc đổi **Tên bước** không làm mất tiến độ đã chạy; chỉ khi bạn thay đổi thiết lập xử lý (như giọng nói, ngôn ngữ, câu điều kiện) hoặc đổi dây nối thì kết quả cũ mới cần chạy lại.

## Lỗi thường gặp

- Không chạy được quy trình có bước **Trợ lý AI** hoặc **Cuộc gọi**: Hai bước này hiện có nhãn **Bản nháp cục bộ**, chỉ dùng để phác thảo trên khung vẽ hoặc bấm **Chuẩn bị cuộc gọi** để chuyển sang trang **Cuộc gọi**, chưa hỗ trợ thực thi tự động trong luồng chạy.
- Quy trình báo lỗi không tương thích ngay khi bấm **Chạy quy trình**: Kiểm tra lại thứ tự nối dây giữa các bước. Văn bản chỉ nối được vào **Dịch**, **Nói**, **Điều kiện** hoặc **Kết thúc**; âm thanh chỉ nối được vào **Chép lời**, **Chuyển đổi**, **Chuẩn hóa âm thanh** hoặc **Kết thúc**.
- Lỗi tại bước **Điều kiện**: Bước **Điều kiện** chỉ nhận dữ liệu đầu vào là văn bản (không nhận âm thanh) và bắt buộc phải nối đủ cả hai cổng **Có** và **Không**. Nếu hai nhánh gộp lại vào chung một bước phía sau, cả hai nhánh phải xuất ra cùng một kiểu dữ liệu (cùng là văn bản hoặc cùng là âm thanh).
- Nút **Xóa** quy trình bị mờ: Bạn không thể xóa khi danh sách **Quy trình** chỉ còn duy nhất một quy trình hoặc khi quy trình đang trong lúc chạy.

## Bài liên quan

- [Bắt đầu với eVoice Studio](../bat-dau/)
- [Quản lý giọng đã lưu](../giong-da-luu/)
- [Lồng tiếng hàng loạt](../long-tieng-hang-loat/)
- [Phiên âm và đọc chính tả](../phien-am/)
- [Công cụ: so sánh và chuyển giọng](../cong-cu/)
