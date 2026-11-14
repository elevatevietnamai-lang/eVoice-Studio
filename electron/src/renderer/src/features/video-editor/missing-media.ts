import { useQuery } from '@tanstack/react-query';
import { apiPath } from '@/lib/api/client';
import type { EditorMedia } from './project';

const NONE: ReadonlySet<string> = new Set();

/**
 * Ids of the uploads that are no longer on the engine (a project outlives its
 * files: another data folder, deleted files). Only a 404 or 410 counts as
 * missing, so an engine that is still starting flags nothing.
 */
export async function findMissing(
  media: readonly EditorMedia[],
  probe: (url: string) => Promise<{ status: number }> = (url) => fetch(url, { method: 'HEAD' }),
): Promise<Set<string>> {
  const results = await Promise.all(
    media.map(async (item) => {
      try {
        const { status } = await probe(apiPath(item.url));
        return status === 404 || status === 410 ? item.id : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(results.filter((id): id is string => id !== null));
}

export function useMissingMedia(media: readonly EditorMedia[]): ReadonlySet<string> {
  const ids = media.map((item) => item.id).sort();
  const { data } = useQuery({
    queryKey: ['editor-missing-media', ids],
    queryFn: () => findMissing(media),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  return ids.length ? (data ?? NONE) : NONE;
}
