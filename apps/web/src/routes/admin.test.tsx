// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useRouterState } = vi.hoisted(() => ({ useRouterState: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...original,
    Link: ({
      children,
      className,
      to,
    }: {
      children: ReactNode;
      className?: string;
      to: string;
    }) => (
      <a className={className} href={to}>
        {children}
      </a>
    ),
    Outlet: () => <div data-testid="admin-outlet" />,
    useRouterState,
  };
});

import { Route as rootRoute } from './__root';
import { Route } from './admin';

let pathname = '/admin';

/**
 * Renders the admin layout at the current pathname and returns the section links.
 * @returns the section links keyed by accessible name
 */
function renderLayout() {
  const Layout = Route.options.component;
  if (!Layout) throw new Error('admin route has no component');
  render(<Layout />);
  return {
    aiMessages: screen.getByRole('link', { name: 'AI messages' }),
    languages: screen.getByRole('link', { name: 'Languages' }),
    translations: screen.getByRole('link', { name: 'Translations' }),
  };
}

describe('admin layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathname = '/admin';
    useRouterState.mockImplementation(
      (opts: { select: (state: { location: { pathname: string } }) => string }) =>
        opts.select({ location: { pathname } }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('hangs off the root route', () => {
    expect(Route.options.getParentRoute()).toBe(rootRoute);
  });

  it('marks only the translations section active', () => {
    pathname = '/admin/translations';

    const links = renderLayout();

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeTruthy();
    expect(links.translations.className).toBe('active');
    expect(links.languages.className).toBe('');
    expect(links.aiMessages.className).toBe('');
    expect(screen.getByTestId('admin-outlet')).toBeTruthy();
  });

  it('marks only the languages section active', () => {
    pathname = '/admin/languages';

    const links = renderLayout();

    expect(links.translations.className).toBe('');
    expect(links.languages.className).toBe('active');
    expect(links.aiMessages.className).toBe('');
  });

  it('marks only the AI messages section active', () => {
    pathname = '/admin/ai-messages';

    const links = renderLayout();

    expect(links.translations.className).toBe('');
    expect(links.languages.className).toBe('');
    expect(links.aiMessages.className).toBe('active');
  });
});
