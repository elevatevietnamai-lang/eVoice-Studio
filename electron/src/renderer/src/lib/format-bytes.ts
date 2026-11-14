/** Human-readable size for download progress: one decimal below 10 GB, whole GB above. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3)
    return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}
