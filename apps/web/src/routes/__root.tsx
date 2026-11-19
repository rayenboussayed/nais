import { createRootRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router';

import { hasSession } from '../lib/session';

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login') return;
    if (!(await hasSession())) {
      throw redirect({ to: '/login' });
    }
  },
  component: RootComponent,
});

/**
 * Root layout: the route shell around the outlet.
 * @returns the rendered layout
 */
function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isLogin = pathname === '/login';

  return (
    <div className="app-shell">
      {!isLogin && (
        <header className="topbar">
          <span className="brand">trainslator</span>
          <nav aria-label="Main" className="topnav">
            <Link activeProps={{ className: 'active' }} to="/">
              Playground
            </Link>
            <Link activeProps={{ className: 'active' }} to="/studio">
              Studio
            </Link>
            <Link activeProps={{ className: 'active' }} to="/admin">
              Admin
            </Link>
          </nav>
        </header>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
