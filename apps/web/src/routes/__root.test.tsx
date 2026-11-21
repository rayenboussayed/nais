// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hasSession, redirect, useRouterState } = vi.hoisted(() => ({
  hasSession: vi.fn<() => Promise<boolean>>(),
  redirect: vi.fn((options: { to: string }) => ({ isRedirect: true as const, to: options.to })),
  useRouterState: vi.fn(),
}));

vi.mock('../lib/session', () => ({ hasSession }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...original,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    Outlet: () => <div data-testid="root-outlet" />,
    redirect,
    useRouterState,
  };
});

import { Route } from './__root';

/**
 * Invokes the root route's beforeLoad guard for a pathname.
 * @param pathname - the location to guard
 */
async function guard(pathname: string): Promise<void> {
  const beforeLoad = Route.options.beforeLoad;
  if (!beforeLoad) throw new Error('root route has no beforeLoad');
  await beforeLoad({ location: { pathname } } as never);
}

let pathname = '/';

describe('root route guard and layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathname = '/';
    useRouterState.mockImplementation(
      (opts: { select: (state: { location: { pathname: string } }) => string }) =>
        opts.select({ location: { pathname } }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('lets the login route through without probing the session', async () => {
    hasSession.mockResolvedValue(false);

    await expect(guard('/login')).resolves.toBeUndefined();

    expect(hasSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('allows a signed-in visitor on protected routes', async () => {
    hasSession.mockResolvedValue(true);

    await expect(guard('/studio')).resolves.toBeUndefined();

    expect(hasSession).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects an anonymous visitor to /login', async () => {
    hasSession.mockResolvedValue(false);

    let caught: unknown;
    try {
      await guard('/studio');
    } catch (error) {
      caught = error;
    }

    expect(redirect).toHaveBeenCalledWith({ to: '/login' });
    expect(caught).toEqual({ isRedirect: true, to: '/login' });
  });

  it('hides the navigation shell on the login page', () => {
    pathname = '/login';
    const Layout = Route.options.component;
    if (!Layout) throw new Error('root route has no component');

    render(<Layout />);

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByText('trainslator')).toBeNull();
    expect(screen.getByTestId('root-outlet')).toBeTruthy();
  });

  it('shows the main navigation for signed-in pages', () => {
    pathname = '/studio';
    const Layout = Route.options.component;
    if (!Layout) throw new Error('root route has no component');

    render(<Layout />);

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByText('trainslator')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Playground' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Studio' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByTestId('root-outlet')).toBeTruthy();
  });
});
