/** Guide: Cài đặt. */
export default {
  slug: 'cai-dat',
  title: 'Cài đặt',
  order: 16,
  steps: [
    { id: 'chung', route: '/settings/general', caption: 'Cài đặt chung' },
    { id: 'giao-dien', route: '/settings/appearance', caption: 'Giao diện' },
    { id: 'model', route: '/settings/models', caption: 'Model' },
    { id: 'mang', route: '/settings/network', caption: 'Mạng và mirror' },
    { id: 'hieu-nang', route: '/settings/performance', caption: 'Hiệu năng' },
    { id: 'luu-tru', route: '/settings/storage', caption: 'Lưu trữ' },
    { id: 'quyen-rieng-tu', route: '/settings/privacy', caption: 'Quyền riêng tư' },
    { id: 'cap-nhat', route: '/settings/updates', caption: 'Cập nhật' },
  ],
};
