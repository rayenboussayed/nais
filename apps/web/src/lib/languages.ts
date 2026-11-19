import type { KeysetList, Language } from '@trainslator/shared';

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

/** Language catalogue row as returned by the API (ISO 639-1, name, nativeName, dir). */
type LanguageRow = Language;

/**
 * Loads the language catalogue (cached for the session).
 * @returns the query for the language list
 */
export function useLanguages() {
  return useQuery({
    queryFn: fetchAllLanguages,
    queryKey: ['languages'],
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
  let cursor: null | { lastCreatedAt: string; lastId: string } = null;
  for (let hop = 0; hop < 10; hop += 1) {
    const query = new URLSearchParams({ orderBy: 'asc', pageSize: '100' });
    if (cursor) {
      query.set('lastId', cursor.lastId);
      query.set('lastCreatedAt', cursor.lastCreatedAt);
    }
    const page = await apiFetch<KeysetList<LanguageRow>>(`/api/languages?${query.toString()}`);
    collected.push(...page.items);
    if (!page.next) return collected;
    cursor = page.next;
  }
  return collected;
}
