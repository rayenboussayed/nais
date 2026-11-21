import { useMemo } from 'react';

import type { Language, Translation } from '../../lib/types';

import { AdminSearch, Pagination } from '../../components/AdminBits';
import { formatTimestamp } from '../../lib/admin';

interface TranslationsListProps {
  canBack: boolean;
  hasNext: boolean;
  isFetching: boolean;
  languageId: string;
  languages: Language[];
  namespace: string;
  onBack: () => void;
  onDelete: (row: Translation) => void;
  onEdit: (row: Translation) => void;
  onLanguageChange: (value: string) => void;
  onNamespaceChange: (value: string) => void;
  onNew: () => void;
  onNext: () => void;
  onSearchChange: (value: string) => void;
  rows: Translation[];
  search: string;
}

/**
 * Search, filters, keyset pager and table for the translations admin page.
 * @param root0 - the component props
 * @param root0.canBack - whether a previous keyset page exists
 * @param root0.hasNext - whether another keyset page follows
 * @param root0.isFetching - shows the loading indicator while the list fetches
 * @param root0.languageId - selected language filter value
 * @param root0.languages - languages used by the filter and the name lookup
 * @param root0.namespace - selected namespace filter value
 * @param root0.onBack - step back one page
 * @param root0.onDelete - soft-delete a row after confirmation
 * @param root0.onEdit - open the edit form for a row
 * @param root0.onLanguageChange - change the language filter and reset the cursor
 * @param root0.onNamespaceChange - change the namespace filter and reset the cursor
 * @param root0.onNew - open the create form
 * @param root0.onNext - step forward one page
 * @param root0.onSearchChange - replace the search term
 * @param root0.rows - translations on the current page
 * @param root0.search - current search term
 * @returns the rendered list section
 */
export function TranslationsList({
  canBack,
  hasNext,
  isFetching,
  languageId,
  languages,
  namespace,
  onBack,
  onDelete,
  onEdit,
  onLanguageChange,
  onNamespaceChange,
  onNew,
  onNext,
  onSearchChange,
  rows,
  search,
}: TranslationsListProps) {
  const languageName = useMemo(
    () => new Map(languages.map((language: Language) => [language.id, language.iso6391])),
    [languages],
  );

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Translations</h1>
        <div className="row">
          <AdminSearch
            ariaLabel="Search translations"
            onChange={onSearchChange}
            placeholder="Search key or text…"
            value={search}
          />
          <select
            aria-label="Filter by language"
            onChange={(event) => onLanguageChange(event.target.value)}
            value={languageId}
          >
            <option value="">All languages</option>
            {languages.map((language: Language) => (
              <option key={language.id} value={language.id}>
                {language.iso6391} — {language.nativeName}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by namespace"
            onChange={(event) => onNamespaceChange(event.target.value)}
            value={namespace}
          >
            <option value="">All namespaces</option>
            <option value="static">static</option>
            <option value="dynamic">dynamic</option>
          </select>
          <button className="button" onClick={onNew} type="button">
            New translation
          </button>
        </div>
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Text</th>
              <th>Key</th>
              <th>Lang</th>
              <th>Namespace</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ maxWidth: 320 }}>
                  {row.text.slice(0, 120)}
                  {row.text.length > 120 ? '…' : ''}
                </td>
                <td className="mono" style={{ maxWidth: 220, wordBreak: 'break-all' }}>
                  {row.key.slice(0, 30)}…
                </td>
                <td className="mono">{languageName.get(row.languageId) ?? '?'}</td>
                <td>
                  <span className={`badge ${row.namespace === 'dynamic' ? 'badge-warn' : ''}`}>
                    {row.namespace}
                  </span>
                </td>
                <td className="muted">{formatTimestamp(row.updatedAt)}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <button
                      className="button button-ghost button-small"
                      onClick={() => onEdit(row)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button button-danger button-small"
                      onClick={() => onDelete(row)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td className="muted" colSpan={6} style={{ padding: 32, textAlign: 'center' }}>
                  No translations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        canBack={canBack}
        hasNext={hasNext}
        isFetching={isFetching}
        onBack={onBack}
        onNext={onNext}
      />
    </>
  );
}
