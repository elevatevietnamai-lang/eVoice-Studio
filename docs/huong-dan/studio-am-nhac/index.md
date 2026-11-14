---
title: Studio âm nhạc
description: Hướng dẫn cài engine ACE-Step, viết mô tả và lời bài hát để tạo nhạc ngay trên máy với eVoice Studio.
slug: studio-am-nhac
order: 10
group: stories
updated: 2026-11-14
app_version: 0.5.7-beta.3
status: draft
---

## Tính năng này làm gì

**Studio âm nhạc** tạo bản nhạc không lời hoặc có lời hát bằng engine ACE-Step 1.5 ngay trên máy của bạn. Bạn cũng có thể phối lại phong cách của một bài sẵn có bằng chế độ **Cover** hoặc sửa một đoạn nhạc bất kỳ bằng chế độ **Vẽ lại**. Mọi khâu tạo nhạc diễn ra cục bộ, không tải dữ liệu âm thanh của bạn lên mạng.

## Cần chuẩn bị

- Khoảng 15 GB dung lượng ổ cứng trống để tải mã nguồn engine ACE-Step, môi trường Python và model tạo nhạc lần đầu.
- Kết nối mạng trong lần đầu bấm **Cài engine nhạc** (hoặc khi bạn chủ động tải thêm model mở rộng); sau khi cài xong, tính năng chạy hoàn toàn ngoại tuyến.
- Nếu muốn bật **Thinking (chất lượng cao)**, máy cần GPU có hơn 6 GB bộ nhớ (từ 6 GB đến 12 GB dùng model 0.6B cần tải thêm khoảng 1,4 GB; trên 12 GB dùng model 1.7B đi kèm khi cài engine).

## Các bước

### 1. Cài engine ACE-Step trong lần đầu mở trang

Mở mục **Studio âm nhạc** từ thanh điều hướng hoặc hộp **Tìm kiếm…**.

![Giao diện trang Studio âm nhạc khi mở lần đầu](shots/mo-trang.png)

Bấm nút **Cài engine nhạc** trong khung **Engine nhạc** ở cột bên trái để tải engine và model về máy. Chờ thanh tiến trình chạy xong cho đến khi ứng dụng báo **Đã cài engine nhạc.**; nếu mạng bị ngắt giữa chừng, bạn chỉ cần bấm cài lại để tiếp tục từ phần đã tải.

### 2. Viết mô tả và lời bài hát

Chọn **Bài mới** ở mục **Chế độ** để sáng tác bài nhạc mới từ đầu.

Nhập phong cách, nhạc cụ và nhịp điệu mong muốn vào ô **Mô tả bản nhạc**, hoặc bấm chọn nhanh các mẫu gợi ý như **calm lo-fi**, **upbeat pop**, **cinematic ambient**, **energetic electronic**, **acoustic guitar**. Bấm mở **Thẻ phong cách** nếu bạn muốn chèn thêm từ khóa theo **Thể loại**, **Nhạc cụ** và **Cảm xúc**.

Giữ công tắc **Không lời** bật nếu bạn chỉ cần nhạc nền. Tắt công tắc **Không lời** khi muốn tạo bài hát có giọng ca, sau đó nhập lời vào ô **Lời bài hát**, bấm các nút gắn nhãn cấu trúc bài như `[verse]`, `[chorus]`, `[bridge]` để định hình bố cục và chọn đúng **Ngôn ngữ giọng hát**.

Kéo thanh trượt **Độ dài** để chọn thời lượng từ 10 đến 240 giây và nhập số vào ô **Nhịp độ (BPM, không bắt buộc)** (hoặc để trống ở mức **Tự động**). Nếu cần chỉnh **Mô hình**, **Giọng (key)**, **Nhịp**, **Số bản** (1–4 bản cùng lúc), **Số bước**, **Cách lấy mẫu**, **Định dạng file** (WAV, FLAC, MP3) hoặc chọn **Âm thanh tham chiếu**, hãy bấm mở khung **Nâng cao**.

### 3. Tạo bản nhạc

Bật **Thinking (chất lượng cao)** nếu GPU của bạn hỗ trợ và bạn muốn mô hình ngôn ngữ lên bố cục trước khi dựng âm thanh, hoặc bấm **Trau chuốt bằng mô hình ngôn ngữ** rồi chọn **Áp dụng** để nhận gợi ý chỉnh mô tả và thông số.

Bấm **Tạo nhạc** ở cuối cột bên trái. Trong lúc nút chuyển sang trạng thái **Đang tạo…**, bài đầu tiên có thể mất vài phút để nạp model vào bộ nhớ. Khi hoàn tất, ứng dụng thông báo **Đã lưu bài nhạc vào thư viện.**

### 4. Nghe thử, tải về và quản lý trong thư viện

Chọn bài vừa tạo trong danh sách **Thư viện nhạc** ở khung bên phải để mở trình phát sóng âm và bấm **Phát** hoặc **Tạm dừng** để nghe thử.

Bấm biểu tượng **Tải bài nhạc** trên dòng bài nhạc để lưu file âm thanh (WAV, FLAC hoặc MP3) về máy, hoặc bấm **Xóa bài nhạc** khi không cần giữ lại.

Bấm **Dùng lại thiết lập** trên khung bài đang chọn nếu bạn muốn nạp lại toàn bộ thông số của bài đó vào biểu mẫu bên trái để tinh chỉnh tiếp. Bạn cũng có thể chuyển sang chế độ **Cover** hoặc **Vẽ lại** để biến tấu dựa trên **Bài gốc** lấy bằng nút **Chọn từ thư viện** hoặc **Tải lên** từ máy.

## Mẹo

- Bấm nút **Giải phóng bộ nhớ GPU** ở cuối cột trái sau khi tạo nhạc xong nếu bạn sắp chuyển sang lồng tiếng hoặc phiên âm trên máy có ít bộ nhớ GPU.
- Khi tạo bài có lời hát, hãy chọn **Ngôn ngữ giọng hát** khớp với ngôn ngữ bạn viết trong ô **Lời bài hát** để giọng hát phát âm rõ chữ.
- Trong mục **Nâng cao**, giữ **Cách lấy mẫu** ở mức **Ổn định (ODE)** khi bạn muốn cùng một seed cho ra kết quả nhất quán, hoặc chọn **Biến hoá (SDE)** và tăng **Số bản** lên 2–4 để có nhiều phương án lựa chọn trong một lần chạy.
- Ở chế độ **Cover**, giảm thanh trượt **Giữ giống bản gốc** xuống thấp nếu bạn muốn đổi phong cách mạnh hơn so với bài gốc. Ở chế độ **Vẽ lại**, khoanh vùng **Đoạn cần tạo lại** vào đúng phần nhạc bị phô để sửa riêng đoạn đó mà vẫn giữ nguyên phần còn lại.

## Lỗi thường gặp

- Không bấm được nút **Tạo nhạc**: Kiểm tra xem bạn đã cài xong **Engine nhạc** chưa, ô **Mô tả bản nhạc** đã có nội dung chưa, và nếu đang ở chế độ **Cover** hoặc **Vẽ lại** thì đã chọn **Bài gốc** chưa.
- Báo lỗi GPU đang bận khi bấm **Tạo nhạc**: Engine tạo nhạc ACE-Step không dùng chung GPU cùng lúc với tác vụ lồng tiếng hoặc chép lời. Hãy đợi tác vụ lồng tiếng/phiên âm chạy xong rồi tạo nhạc lại.
- Không bật được công tắc **Thinking (chất lượng cao)**: Tính năng này báo **Thinking cần GPU có hơn 6 GB bộ nhớ.** trên các máy chỉ chạy CPU hoặc có GPU từ 6 GB trở xuống. Với GPU từ 6–12 GB, hãy bấm nút tải mô hình ngôn ngữ 0.6B trước khi bật.
- Tải engine bị dừng sau thời gian dài mạng chập chờn: Nếu quá trình tải không nhận thêm dữ liệu mới trong 20 phút, ứng dụng sẽ dừng bước cài và giữ nguyên các file đã tải về; bạn chỉ cần bấm **Cài engine nhạc** lại để tiếp tục.

## Bài liên quan

- [Bắt đầu với eVoice Studio](../bat-dau/)
- [Truyện nhiều giọng](../truyen/)
- [Sách nói](../sach-noi/)
- [Lồng tiếng video](../long-tieng-video/)
- [Khắc phục sự cố](../khac-phuc-su-co/)
