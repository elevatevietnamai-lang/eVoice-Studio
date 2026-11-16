---
title: Trình dựng video
description: Hướng dẫn cắt ghép clip, chèn chữ, phụ đề tự động, hiệu ứng và xuất video MP4 trên timeline nhiều track ngay trên máy với eVoice Studio.
slug: trinh-dung-video
order: 19
group: dub
updated: 2026-11-15
app_version: 0.5.7-beta.3
status: approved
---

## Tính năng này làm gì

Trang **Dựng video** giúp bạn cắt ghép video, ảnh và âm thanh trên dòng thời gian nhiều track trực tiếp trên máy tính mà không cần tải tệp lên mạng. Bạn có thể chèn chữ, tạo phụ đề tự động từ giọng nói trong dự án, thêm sticker, tách phông, chỉnh màu và xuất thành tệp MP4.

## Cần chuẩn bị

- Các tệp video, hình ảnh hoặc âm thanh trên máy tính để đưa vào dự án.
- Công cụ media `ffmpeg` đã cài đặt sẵn trong lần chạy đầu để xuất tệp MP4 trên mọi hệ điều hành.
- Một model nhận diện giọng nói đã cài trong mục **Chép lời** nếu bạn muốn dùng tính năng **Phụ đề tự động**.
- Tính năng tiêu đề hoạt hình đã được bật trước ở trang **Video quảng cáo** nếu bạn muốn dùng **Tiêu đề hoạt hình** trên ứng dụng desktop.

## Các bước

### 1. Mở Dựng video và thiết lập dự án

![Trang Trình dựng video trong eVoice Studio](shots/mo-trang.png)

1. Chọn nhóm **Lồng tiếng** trên thanh điều hướng bên trái rồi mở trang **Dựng video**.
2. Bấm nút **Dự án** trên thanh tiêu đề để chuyển giữa các dự án đã lưu trên máy hoặc chọn **Dự án mới** để tạo dòng thời gian trống.
3. Nhập tên vào ô **Tên** ở cột **Dự án** bên phải khi chưa chọn clip nào trên timeline.
4. Chọn tỉ lệ ở mục **Khung hình** gồm **9:16 dọc**, **1:1 vuông** hoặc **16:9 ngang**.
5. Chọn **30 fps** hoặc **60 fps** tại mục **Tốc độ khung hình** và chọn màu tại ô **Nền**.

### 2. Nhập tư liệu và đưa vào timeline nhiều track

1. Bấm nút **Nhập** trong cột **Tư liệu** bên trái để chọn các tệp video, ảnh hoặc âm thanh từ máy tính.
2. Bấm nút cộng trên tệp vừa nhập để đưa video hoặc ảnh vào track **Chính**, hoặc đưa tệp âm thanh vào track **Âm thanh**. Đầu phát sẽ tự nhảy tới cuối clip vừa thêm trên track **Chính** để bạn nối tiếp clip sau.
3. Bấm nút thêm lớp trên tệp video hoặc ảnh trong cột **Tư liệu** nếu bạn muốn đặt tệp đó lên một track **Lớp phủ** nằm phía trên track **Chính**.

### 3. Cắt ghép, thêm chữ, sticker và chỉnh thuộc tính

1. Kéo clip trên dòng thời gian để đổi vị trí, hoặc kéo hai đầu clip để cắt ngắn thời lượng. Các clip trên track **Chính** luôn tự động khép sát nhau từ mốc `0:00`.
2. Bấm vào thước thời gian để dời đầu phát, rồi bấm **Tách tại đầu phát (S)** để chia đôi clip đang chọn hoặc bấm **Xoá (Del)** để bỏ clip.
3. Bấm **Thêm chữ** ở cột **Tư liệu** để chèn một lớp văn bản tại đầu phát, sau đó nhập nội dung vào ô **Nội dung** bên cột **Thuộc tính**, đổi **Phông chữ**, **Cỡ chữ**, **Màu**, bật **In đậm** hoặc **Hộp nền**.
4. Bấm **Tiêu đề hoạt hình** (trên ứng dụng desktop), chọn **Mẫu**, nhập **Chữ**, chọn **Màu chữ**, **Màu nhấn**, **Độ dài (giây)**, **Vị trí** rồi bấm **Dựng và thêm** để chèn tiêu đề có nền trong suốt lên track **Lớp phủ**. Khi cần sửa lại, chọn clip tiêu đề rồi bấm **Sửa tiêu đề** và **Dựng lại**.
5. Bấm **Phụ đề tự động** để ứng dụng trộn âm thanh của dự án, chép lời ngay trên máy và tạo một track phụ đề khớp với lời thoại.
6. Chọn các thẻ **Hình khối**, **Mũi tên**, **Khung** hoặc **Emoji** trong mục **Sticker** rồi bấm vào biểu tượng muốn chèn tại đầu phát.
7. Chọn một clip trên timeline để tinh chỉnh ở cột **Thuộc tính** bên phải:
   - Kéo trực tiếp trên khung **Xem trước** hoặc chỉnh **Vị trí ngang**, **Vị trí dọc**, **Tỉ lệ**, **Xoay** và **Độ mờ** trong mục **Vị trí và kích thước**; bấm biểu tượng hình thoi cạnh thông số để đặt keyframe chuyển động theo thời gian.
   - Chọn tông màu ở mục **Màu** (**Gốc**, **Rực rỡ**, **Ấm**, **Lạnh**, **Đen trắng**, **Hoài cổ**) và chỉnh **Độ sáng**, **Tương phản**, **Độ bão hoà**.
   - Chọn hình dạng mặt nạ (**Chữ nhật**, **Tròn**, **Dải ngang**) hoặc bật **Đảo ngược mask** để chỉ hiển thị vùng mong muốn.
   - Bật **Xoá một màu nền** trong mục **Tách phông (chroma key)**, chọn **Màu cần xoá** (**Xanh lá**, **Xanh dương** hoặc màu tuỳ chọn) rồi chỉnh **Độ ngưỡng**, **Độ mềm viền** và **Khử viền màu**.
   - Chỉnh **Âm lượng**, **Tăng dần**, **Tắt dần**, **Tốc độ** (kèm **Giữ cao độ** để giọng không bị méo khi đổi tốc độ) và bật **Giảm khi có giọng** trên clip nhạc nền để tự hạ nhỏ khoảng 12 dB khi có tiếng nói ở track khác.
   - Chọn hiệu ứng ở mục **Chuyển cảnh sang clip sau** (**Mờ dần**, **Mờ qua đen**, **Trượt**, **Đẩy**, **Thu phóng**, **Xoá ngang**) và đặt **Độ dài chuyển cảnh** cho các clip nối tiếp nhau trên track **Chính**.

### 4. Xuất video

1. Bấm **Phát** (hoặc phím `Space`) để kiểm tra lại toàn bộ hình ảnh và âm thanh trên khung **Xem trước**.
2. Kiểm tra nút **Tắt tiếng track** hoặc **Ẩn track** ở đầu mỗi track để đảm bảo các lớp muốn xuất đều đang bật.
3. Bấm **Xuất video** ở góc phải phía trên dòng thời gian và chọn nơi lưu tệp MP4 khi quá trình dựng hoàn tất (nếu cần dừng giữa chừng, bấm **Huỷ**).

## Mẹo

- Dùng phím tắt để thao tác nhanh trên dòng thời gian: `Space` để phát hoặc tạm dừng, `S` để tách clip tại đầu phát, `←` / `→` để nhích từng khung hình (giữ thêm `Shift` để nhảy 1 giây), `Ctrl+Z` để **Hoàn tác (Ctrl+Z)**, `Ctrl+Shift+Z` để **Làm lại (Ctrl+Shift+Z)** và `Ctrl` + con lăn chuột để thu phóng timeline.
- Khi xoá hoặc nhân bản một dự án trong menu **Dự án**, các tệp media đã nhập vẫn được giữ lại trên máy để các dự án khác dùng chung mà không cần nhập lại.
- Với các đoạn lồng tiếng cần đọc nhanh hơn hoặc chậm hơn một chút, hãy đổi **Tốc độ** và giữ bật **Giữ cao độ** để giọng nói vẫn tự nhiên.

## Lỗi thường gặp

- nút **Xuất video** bị mờ không bấm được: dòng thời gian đang trống, tổng thời lượng vượt quá giới hạn 5 phút (**Video dài tối đa 5 phút.**) hoặc có clip báo **Mất tệp**. Hãy thêm clip vào timeline, rút ngắn dự án xuống tối đa 5 phút, hoặc xoá/nhập lại tệp bị thiếu trong cột **Tư liệu**.
- bấm **Phụ đề tự động** báo **Dự án không có âm thanh để tạo phụ đề.** hoặc **Không tìm thấy lời nói.**: kiểm tra xem các clip có tiếng trên timeline có đang bị tắt âm ở mục **Tiếng của clip** hoặc **Tắt tiếng track** hay không, và đảm bảo đã cài đặt model trong trang **Chép lời**.
- bấm **Tiêu đề hoạt hình** báo **Hãy bật tiêu đề hoạt hình ở trang Video quảng cáo trước.** hoặc **Tiêu đề hoạt hình cần ứng dụng desktop.**: mở trang **Video quảng cáo** trên ứng dụng desktop chạy cục bộ để bật tính năng tiêu đề hoạt hình và xác nhận tải công cụ dựng hình trước khi sử dụng.
- khung xem trước bị giật khi phát hoặc chờ vài giây khi mới đổi tốc độ clip: khung **Xem trước** vẽ ở độ phân giải thật nên GPU yếu có thể bỏ qua một số khung hình lúc phát thử (bản xuất MP4 vẫn đủ khung hình), và lần đầu bật **Giữ cao độ** ở tốc độ mới ứng dụng cần vài giây để kéo giãn âm thanh.

## Bài liên quan

- [Lồng tiếng video](../long-tieng-video/)
- [Video quảng cáo (Promo)](../video-quang-cao/)
- [Phiên âm và đọc chính tả](../phien-am/)
- [Studio âm nhạc](../studio-am-nhac/)
- [Dự án](../du-an/)
