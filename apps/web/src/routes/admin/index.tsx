import { createRoute, redirect } from '@tanstack/react-router';

import { Route as adminRoute } from '../admin';

export const Route = createRoute({
  beforeLoad: () => {
    throw redirect({ to: '/admin/translations' });
  },
  component: () => null,
  getParentRoute: () => adminRoute,
  path: '/',
});
