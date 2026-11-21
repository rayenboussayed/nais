import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { KeysetCursor, KeysetList, Language } from './types';

import { apiFetch, toQueryString } from './api';

/** Language catalogue row as returned by the API (ISO 639-1, name, nativeName, dir). */
type LanguageRow = Language;

/** Query key shared by the catalogue query and its post-mutation invalidation. */
const languageQueryKey = ['languages'];

/**
 * Returns a callback that marks the cached catalogue stale so mounted language
 * selectors (Playground, Studio, admin translations) refetch after a mutation.
 * @returns a callback that invalidates the language catalogue query
 */
export function useInvalidateLanguages(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: languageQueryKey });
}

/**
 * Loads the language catalogue (cached for the session).
 * @returns the query for the language list
 */
export function useLanguages() {
  return useQuery({
    queryFn: fetchAllLanguages,
    queryKey: languageQueryKey,
    staleTime: Infinity,
  });
}

/**
 * All languages, fetched once per session. The seeded catalogue is a fixed
 * 184-row fixture; pageSize=100 walks the two pages.
 * @returns the full catalogue
 */
async function fetchAllLanguages(): Promise<LanguageRow[]> {
  const collected: LanguageRow[] = [];
  let cursor: KeysetCursor | null = null;
  for (let hop = 0; hop < 10; hop += 1) {
    const page: KeysetList<LanguageRow> = await apiFetch<KeysetList<LanguageRow>>(
      `/api/languages${toQueryString({
        lastCreatedAt: cursor?.lastCreatedAt,
        lastId: cursor?.lastId,
        orderBy: 'asc',
        pageSize: '100',
      })}`,
    );
    collected.push(...page.items);
    if (!page.next) return collected;
    cursor = page.next;
  }
  return collected;
}
