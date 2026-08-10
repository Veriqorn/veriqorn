export interface SidebarNavigationItem {
  icon: 'Bot' | 'LayoutDashboard' | 'Rocket' | 'Settings'
  id: 'launches' | 'overview' | 'settings'
  label: string
  requiresPro?: boolean
  to?: '/projects/$projectId/dashboard' | '/projects/$projectId/launches' | '/settings'
}

export const sidebarNavigation: SidebarNavigationItem[] = [
  {
    id: 'overview',
    icon: 'LayoutDashboard',
    label: 'Overview',
    to: '/projects/$projectId/dashboard',
  },
  {
    id: 'launches',
    icon: 'Rocket',
    label: 'Launches',
    to: '/projects/$projectId/launches',
  },
  {
    id: 'settings',
    icon: 'Settings',
    label: 'Settings',
    to: '/settings',
  },
]
