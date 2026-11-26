// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Language, Translation } from '../../lib/types';

import { TranslationsList } from './translations-list';

const language: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'ltr',
  id: '10000000-0000-4000-8000-000000000001',
  iso6391: 'fr',
  isSource: false,
  name: 'French',
  nativeName: 'Français',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

/**
 * Builds the full prop bag for the list with inert callbacks.
 * @returns the list props
 */
function baseProps() {
  return {
    canBack: true,
    hasNext: true,
    isFetching: false,
    languageId: '',
    languages: [language],
    namespace: '',
    onBack: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onLanguageChange: vi.fn(),
    onNamespaceChange: vi.fn(),
    onNew: vi.fn(),
    onNext: vi.fn(),
    onSearchChange: vi.fn(),
    rows: [translation('30000000-0000-4000-8000-000000000001', 'Bonjour', 'static')],
    search: '',
  };
}

/**
 * Builds one translation row fixture.
 * @param id - translation id
 * @param text - translated text
 * @param namespace - namespace label
 * @returns a translation row
 */
function translation(id: string, text: string, namespace: 'dynamic' | 'static'): Translation {
  return {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    id,
    key: 'home.title',
    languageId: language.id,
    namespace,
    parentId: null,
    text,
    updatedAt: '2026-11-18T00:00:00.000Z',
  };
}

describe('TranslationsList', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders rows with language lookup, truncated text and namespace badges', () => {
    const props = baseProps();
    props.rows = [
      translation('30000000-0000-4000-8000-000000000002', 'a'.repeat(130), 'static'),
      translation('30000000-0000-4000-8000-000000000003', 'Court', 'dynamic'),
    ];
    render(<TranslationsList {...props} />);

    expect(screen.getByText(`${'a'.repeat(120)}…`)).toBeTruthy();
    expect(screen.getByText('Court')).toBeTruthy();
    expect(screen.queryByText('a'.repeat(130))).toBeNull();
    expect(screen.getAllByText('home.title…')).toHaveLength(2);
    expect(screen.getAllByText('fr')).toHaveLength(2);
    expect(screen.getAllByText('dynamic').length).toBeGreaterThan(0);
    expect(screen.getAllByText('static').length).toBeGreaterThan(0);
  });

  it('shows a question mark for a row whose language is unknown', () => {
    const props = baseProps();
    const orphan = translation('30000000-0000-4000-8000-000000000004', 'Orphelin', 'static');
    props.rows = [{ ...orphan, languageId: 'missing' }];
    props.languages = [];
    render(<TranslationsList {...props} />);

    expect(screen.getByText('?')).toBeTruthy();
  });

  it('shows the empty state when there are no rows', () => {
    const props = baseProps();
    props.rows = [];
    render(<TranslationsList {...props} />);

    expect(screen.getByText('No translations found.')).toBeTruthy();
  });

  it('wires search, filters, row actions and pagination to their callbacks', () => {
    const props = baseProps();
    render(<TranslationsList {...props} />);

    fireEvent.change(screen.getByLabelText('Search translations'), {
      target: { value: 'home' },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith('home');

    fireEvent.change(screen.getByLabelText('Filter by language'), {
      target: { value: language.id },
    });
    expect(props.onLanguageChange).toHaveBeenCalledWith(language.id);

    fireEvent.change(screen.getByLabelText('Filter by namespace'), {
      target: { value: 'dynamic' },
    });
    expect(props.onNamespaceChange).toHaveBeenCalledWith('dynamic');

    fireEvent.click(screen.getByRole('button', { name: 'New translation' }));
    expect(props.onNew).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(props.onEdit).toHaveBeenCalledWith(props.rows[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith(props.rows[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
    expect(props.onBack).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(props.onNext).toHaveBeenCalled();
  });

  it('shows the loading indicator while fetching', () => {
    const props = baseProps();
    props.isFetching = true;
    render(<TranslationsList {...props} />);

    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
