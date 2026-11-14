/**
 * Guide: Khắc phục sự cố.
 * Settings → Support is left out: it carries the owner's donation details, not troubleshooting.
 */
export default {
  slug: 'khac-phuc-su-co',
  title: 'Khắc phục sự cố',
  order: 17,
  steps: [
    { id: 'nhat-ky', route: '/settings/logs', caption: 'Nhật ký' },
    { id: 'chan-doan', route: '/settings/diagnostics', caption: 'Chẩn đoán' },
  ],
};
