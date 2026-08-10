import { authedRoute } from '@/routes/authed'
import { extensionsHostRoute } from '@/routes/extensions-host'
import { globalDashboardRoute, globalLaunchDetailRoute, globalLaunchesRoute } from '@/routes/global-redirects'
import { homeRoute } from '@/routes/home'
import { loginRoute } from '@/routes/login'
import { profileRoute } from '@/routes/profile'
import { projectDashboardRoute } from '@/routes/project-dashboard'
import { projectLaunchDetailRoute } from '@/routes/project-launch-detail'
import { projectLaunchesRoute } from '@/routes/project-launches'
import { projectLayoutRoute } from '@/routes/project-layout'
import { projectTestResultsRoute } from '@/routes/project-test-results'
import { rootRoute } from '@/routes/root'
import { settingsRoute } from '@/routes/settings'

const projectRouteTree = projectLayoutRoute.addChildren([
  projectDashboardRoute,
  projectLaunchesRoute,
  projectLaunchDetailRoute,
  projectTestResultsRoute,
])

const authedRouteTree = authedRoute.addChildren([
  globalDashboardRoute,
  globalLaunchesRoute,
  globalLaunchDetailRoute,
  extensionsHostRoute,
  profileRoute,
  settingsRoute,
  projectRouteTree,
])

export const routeTree = rootRoute.addChildren([homeRoute, loginRoute, authedRouteTree])
