import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import type { Translation } from '../../lib/types';

import { useLanguages } from '../../lib/languages';
import { useAdminList } from '../../lib/use-admin-list';
import { Route as adminRoute } from '../admin';
import { type TranslationEditing, TranslationsForm } from './translations-form';
import { TranslationsList } from './translations-list';

export const Route = createRoute({
  component: TranslationsAdmin,
  getParentRoute: () => adminRoute,
  path: '/translations',
});

const PAGE_SIZE = 20;

/**
 * Coordinates the translations list and its create/edit form.
 * @returns the rendered admin page
 */
export function TranslationsAdmin() {
  const { data: languages = [] } = useLanguages();
  const [languageId, setLanguageId] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('');
  const {
    back,
    canBack,
    deleteRow,
    hasNext,
    invalidate,
    isFetching,
    nextPage,
    resetPage,
    rows,
    search,
    setSearch,
  } = useAdminList<Translation>({
    endpoint: '/api/translations',
    extraParams: {
      ...(languageId ? { languageId } : {}),
      ...(namespace ? { namespace } : {}),
    },
    pageSize: PAGE_SIZE,
    resource: 'translations',
  });
  const [editing, setEditing] = useState<TranslationEditing>(null);

  /**
   * Opens a blank create form; the first language is preselected.
   */
  function openCreate() {
    setEditing({ mode: 'create' });
  }

  /**
   * Opens the edit form for a row.
   * @param row - the translation to edit
   */
  function openEdit(row: Translation) {
    setEditing({ mode: 'edit', row });
  }

  /**
   * Soft-deletes a row after confirmation.
   * @param row - the translation to delete
   */
  async function remove(row: Translation) {
    if (!window.confirm(`Soft-delete "${row.text.slice(0, 60)}…"?`)) return;
    try {
      await deleteRow(row.id);
    } catch {
      window.alert('Could not delete the translation.');
    }
  }

  return (
    <div className="stack">
      <TranslationsList
        canBack={canBack}
        hasNext={hasNext}
        isFetching={isFetching}
        languageId={languageId}
        languages={languages}
        namespace={namespace}
        onBack={back}
        onDelete={remove}
        onEdit={openEdit}
        onLanguageChange={(value) => {
          resetPage();
          setLanguageId(value);
        }}
        onNamespaceChange={(value) => {
          resetPage();
          setNamespace(value);
        }}
        onNew={openCreate}
        onNext={nextPage}
        onSearchChange={setSearch}
        rows={rows}
        search={search}
      />
      {editing && (
        <TranslationsForm
          editing={editing}
          languages={languages}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
