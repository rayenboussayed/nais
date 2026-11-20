import type { KeysetList } from '@trainslator/shared';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useCursorStack } from './admin';
import { apiFetch, toQueryString } from './api';

/** List state and actions shared by every admin collection page. */
export interface AdminList<T> {
  /** Step one page back through the keyset cursor stack. */
  back: () => void;
  /** Whether a previous page exists. */
  canBack: boolean;
  /** Soft-delete one row by id, then refresh the list; rejects on failure. */
  deleteRow: (id: string) => Promise<void>;
  /** Whether another page follows the current one. */
  hasNext: boolean;
  /** Refresh the list query, e.g. after a create or edit succeeds. */
  invalidate: () => Promise<void>;
  /** Whether the list query failed on its latest attempt. */
  isError: boolean;
  /** Whether the list query is currently fetching. */
  isFetching: boolean;
  /** Step to the next page when one exists. */
  nextPage: () => void;
  /** Clear the cursor stack, e.g. when a non-search filter changes. */
  resetPage: () => void;
  /** Items on the current page, or an empty array before the first load. */
  rows: T[];
  /** Current search term. */
  search: string;
  /** Replaces the search term and resets the cursor stack to the first page. */
  setSearch: (value: string) => void;
}

/** Configuration for {@link useAdminList}. */
export interface UseAdminListOptions {
  /** Base collection path for list and delete calls, e.g. `/api/languages`. */
  endpoint: string;
  /** Extra list filters; empty strings are skipped by `toQueryString`. */
  extraParams?: Record<string, string | undefined>;
  /** Number of rows requested per page. */
  pageSize: number;
  /** Query-key namespace, normally the last segment of `endpoint`. */
  resource: string;
}

/**
 * Owns the list query, search state, keyset pagination and soft-delete
 * mutation shared by the admin collection pages. Per-page filters are passed
 * through `extraParams`; create/edit forms and visible markup stay in routes.
 * @param options - the endpoint, resource key, page size and optional filters
 * @returns the shared list state and actions
 */
export function useAdminList<T>(options: UseAdminListOptions): AdminList<T> {
  const { endpoint, extraParams, pageSize, resource } = options;
  const queryClient = useQueryClient();
  const { back, canBack, current, next, reset } = useCursorStack();
  const [search, setSearchTerm] = useState('');

  const queryKey = ['admin', resource];
  const params = {
    pageSize: String(pageSize),
    ...(search ? { q: search } : {}),
    ...(extraParams ?? {}),
    ...(current ? { lastCreatedAt: current.lastCreatedAt, lastId: current.lastId } : {}),
  };

  const { data, isError, isFetching } = useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => apiFetch<KeysetList<T>>(`${endpoint}${toQueryString(params)}`),
    queryKey: [...queryKey, params],
  });

  /** Refresh the list query so a mutation's result is reflected. */
  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey });
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`${endpoint}/${id}`, { method: 'DELETE' });
      await invalidate();
    },
  });

  return {
    back,
    canBack,
    deleteRow: (id) => deleteMutation.mutateAsync(id),
    hasNext: Boolean(data?.next),
    invalidate,
    isError,
    isFetching,
    nextPage: () => {
      if (data?.next) next(data.next);
    },
    resetPage: reset,
    rows: data?.items ?? [],
    search,
    setSearch: (value) => {
      reset();
      setSearchTerm(value);
    },
  };
}
