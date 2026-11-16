/** Guide: Lồng tiếng video. */
import { vi } from '../vi.mjs';

export default {
  slug: 'long-tieng-video',
  title: 'Lồng tiếng video',
  order: 6,
  steps: [
    { id: 'mo-trang', route: '/dub', caption: 'Trang Lồng tiếng' },
    {
      id: 'chon-tep',
      caption: 'Chọn video hoặc dán URL',
      highlight: (page) => page.getByRole('button', { name: /^Chọn tệp/ }),
      highlightLabel: 'Chọn tệp…',
    },
    {
      id: 'ngon-ngu-dich',
      caption: 'Chọn ngôn ngữ lồng tiếng',
      highlight: (page) =>
        page.getByRole('heading', { name: new RegExp(`${vi('dub.target_language')}$`) }).first(),
      highlightLabel: vi('dub.target_language'),
    },
    {
      id: 'trinh-dich',
      caption: 'Chọn cách dịch',
      highlight: (page) => page.getByRole('button', { name: vi('dub.translate_with_agent') }),
      highlightLabel: vi('dub.translate_with_agent'),
    },
  ],
};
