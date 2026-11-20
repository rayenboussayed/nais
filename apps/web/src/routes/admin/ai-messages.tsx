import type { AiMessage, AiMessagePrompt } from '@trainslator/shared';

import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { AdminSearch, Pagination } from '../../components/AdminBits';
import { formatTimestamp } from '../../lib/admin';
import { apiFetch } from '../../lib/api';
import { useAdminList } from '../../lib/use-admin-list';
import { Route as adminRoute } from '../admin';

export const Route = createRoute({
  component: AiMessagesAdmin,
  getParentRoute: () => adminRoute,
  path: '/ai-messages',
});

const PAGE_SIZE = 20;

/**
 * Admin list of the model-call audit log: search, expand inline, soft-delete.
 * @returns the rendered admin page
 */
function AiMessagesAdmin() {
  const { back, canBack, deleteRow, hasNext, isFetching, nextPage, rows, search, setSearch } =
    useAdminList<AiMessage>({
      endpoint: '/api/ai-messages',
      pageSize: PAGE_SIZE,
      resource: 'ai-messages',
    });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /**
   * Toggles the inline prompt expansion for one message.
   * @param id - the message id to toggle
   */
  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(id)) updated.delete(id);
      else updated.add(id);
      return updated;
    });
  }

  /**
   * Soft-deletes an audit entry after confirmation.
   * @param row - the message row to delete
   */
  async function remove(row: AiMessage) {
    if (!window.confirm(`Soft-delete this ${row.model} call from the audit log?`)) return;
    try {
      await deleteRow(row.id);
    } catch {
      window.alert('Could not delete the entry.');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>AI messages</h1>
        <AdminSearch
          ariaLabel="Search AI messages"
          onChange={setSearch}
          placeholder="Search model, provider, response…"
          value={search}
        />
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Status</th>
              <th>Response</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="mono">{row.model}</div>
                  <div className="muted" style={{ fontSize: '0.8em' }}>
                    {row.provider}
                  </div>
                </td>
                <td>
                  <span className={statusBadgeClass(row.status)}>{row.status}</span>
                </td>
                <td style={{ maxWidth: 380 }}>
                  {row.response ? (
                    <>
                      {row.response.slice(0, 160)}
                      {row.response.length > 160 ? '…' : ''}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{formatTimestamp(row.createdAt)}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <button
                      className="button button-ghost button-small"
                      onClick={() => toggleExpanded(row.id)}
                      type="button"
                    >
                      {expanded.has(row.id) ? 'Hide' : 'Prompts'}
                    </button>
                    <button
                      className="button button-danger button-small"
                      onClick={() => remove(row)}
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
                <td className="muted" colSpan={5} style={{ padding: 32, textAlign: 'center' }}>
                  No AI messages found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {[...expanded].map((id) => (
        <div className="panel" key={id}>
          <PromptsList messageId={id} />
        </div>
      ))}

      <Pagination
        canBack={canBack}
        hasNext={hasNext}
        isFetching={isFetching}
        onBack={back}
        onNext={nextPage}
      />
    </div>
  );
}

/**
 * Lazily loads and shows the prompts captured for one audit entry.
 * @param root0 - the component props
 * @param root0.messageId - the owning audit entry id
 * @returns the rendered prompt list
 */
function PromptsList({ messageId }: { messageId: string }) {
  const { data, isLoading } = useQuery({
    queryFn: () => apiFetch<AiMessagePrompt[]>(`/api/ai-messages/${messageId}/prompts`),
    queryKey: ['admin', 'ai-messages', messageId, 'prompts'],
  });

  if (isLoading) return <span className="muted">Loading prompts…</span>;
  if (!data || data.length === 0) return <span className="muted">No prompts.</span>;

  return (
    <ol className="stack" style={{ margin: 0, paddingInlineStart: 20 }}>
      {data.map((prompt) => (
        <li key={prompt.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="badge">{prompt.role}</span>
          </div>
          <pre
            className="result-area mono"
            style={{ maxHeight: 180, minHeight: 0, overflow: 'auto' }}
          >
            {prompt.prompt}
          </pre>
        </li>
      ))}
    </ol>
  );
}

/**
 * Maps an audit status to its badge class.
 * @param status - the audit row status
 * @returns the badge class name
 */
function statusBadgeClass(status: AiMessage['status']): string {
  switch (status) {
    case 'completed':
      return 'badge badge-ok';
    case 'failed':
      return 'badge badge-fail';
    default:
      return 'badge badge-warn';
  }
}
