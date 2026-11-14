/** Guide: Nhân bản giọng. */
import { vi } from '../vi.mjs';

export default {
  slug: 'nhan-ban-giong',
  title: 'Nhân bản giọng',
  order: 2,
  steps: [
    { id: 'mo-trang', route: '/clone', caption: 'Trang Nhân bản giọng' },
    {
      id: 'tai-mau-len',
      caption: 'Thả hoặc chọn một file audio mẫu',
      highlight: (page) => page.getByText(vi('clone.drop_audio')),
      highlightLabel: vi('clone.drop_audio'),
    },
    {
      id: 'thu-am',
      caption: 'Hoặc thu âm trực tiếp',
      highlight: (page) => page.getByRole('button', { name: vi('clone.record') }),
      highlightLabel: vi('clone.record'),
    },
    {
      id: 'chon-giong-da-luu',
      caption: 'Chọn một giọng đã lưu để đọc kịch bản',
      do: ({ page }) =>
        page.getByRole('button', { name: 'Giọng Nam Trầm', exact: true }).first().click(),
    },
    {
      id: 'nhap-kich-ban',
      caption: 'Nhập kịch bản rồi bấm Tổng hợp âm thanh',
      do: ({ page }) =>
        page
          .getByRole('textbox')
          .first()
          .fill('Chào mừng bạn đến với eVoice Studio. Hôm nay chúng ta sẽ thử nhân bản giọng nói.'),
      highlight: (page) => page.getByRole('button', { name: new RegExp(vi('clone.synthesize')) }),
      highlightLabel: vi('clone.synthesize'),
    },
  ],
};
