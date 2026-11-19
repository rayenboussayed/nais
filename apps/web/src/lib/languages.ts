import { useQuery } from '@tanstack/react-query';

import type { KeysetList, Language } from '@trainslator/shared';

import { apiFetch } from './api';

/** Language catalogue row as returned by the API (ISO 639-1, name, nativeName, dir). */
type LanguageRow = Language;

/**
 * All languages, fetched once per session. The seeded catalogue is a fixed
 * 184-row fixture; pageSize=100 walks the two pages.
 */
async function fetchAllLanguages(): Promise<LanguageRow[]> {
  const collected: LanguageRow[] = [];
  let cursor: { lastId: string; lastCreatedAt: string } | null = null;
  for (let hop = 0; hop < 10; hop += 1) {
    const query = new URLSearchParams({ pageSize: '100', orderBy: 'asc' });
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

export function useLanguages() {
  return useQuery({
    queryKey: ['languages'],
    queryFn: fetchAllLanguages,
    staleTime: Infinity,
  });
}
