import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { AiMessage, AiMessagePrompt, KeysetList } from '@trainslator/shared';

import { Route as adminRoute } from '../admin';
import { apiFetch, toQueryString } from '../../lib/api';
import { formatTimestamp, useCursorStack } from '../../lib/admin';

export const Route = createRoute({
  getParentRoute: () => adminRoute,
  path: '/ai-messages',
  component: AiMessagesAdmin,
});

const PAGE_SIZE = 20;

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

function PromptsList({ messageId }: { messageId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'ai-messages', messageId, 'prompts'],
    queryFn: () => apiFetch<AiMessagePrompt[]>(`/api/ai-messages/${messageId}/prompts`),
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
          <pre className="result-area mono" style={{ minHeight: 0, maxHeight: 180, overflow: 'auto' }}>
            {prompt.prompt}
          </pre>
        </li>
      ))}
    </ol>
  );
}

function AiMessagesAdmin() {
  const queryClient = useQueryClient();
  const { current, canBack, next, back, reset } = useCursorStack();
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = {
    pageSize: String(PAGE_SIZE),
    ...(q ? { q } : {}),
    ...(current ? { lastId: current.lastId, lastCreatedAt: current.lastCreatedAt } : {}),
  };

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'ai-messages', params],
    queryFn: () => apiFetch<KeysetList<AiMessage>>(`/api/ai-messages${toQueryString(params)}`),
    placeholderData: (previous) => previous,
  });

  const rows = data?.items ?? [];

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(id)) updated.delete(id);
      else updated.add(id);
      return updated;
    });
  }

  async function remove(row: AiMessage) {
    if (!window.confirm(`Soft-delete this ${row.model} call from the audit log?`)) return;
    try {
      await apiFetch(`/api/ai-messages/${row.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'ai-messages'] });
    } catch {
      window.alert('Could not delete the entry.');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>AI messages</h1>
        <input
          type="search"
          placeholder="Search model, provider, response…"
          value={q}
          onChange={(event) => {
            reset();
            setQ(event.target.value);
          }}
          aria-label="Search AI messages"
          style={{ width: 280 }}
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
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button type="button" className="button button-ghost button-small" onClick={() => toggleExpanded(row.id)}>
                      {expanded.has(row.id) ? 'Hide' : 'Prompts'}
                    </button>
                    <button type="button" className="button button-danger button-small" onClick={() => remove(row)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  No AI messages found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {[...expanded].map((id) => (
        <div key={id} className="panel">
          <PromptsList messageId={id} />
        </div>
      ))}

      <div className="pagination">
        {isFetching && <span className="muted">Loading…</span>}
        <button type="button" className="button button-ghost button-small" onClick={back} disabled={!canBack}>
          Newer
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => data?.next && next(data.next)}
          disabled={!data?.next}
        >
          Older
        </button>
      </div>
    </div>
  );
}
