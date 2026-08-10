import { Layout, Rocket, Settings } from 'lucide-react';

export type SidebarItemId = 'overview' | 'launches' | 'settings';

export interface SidebarNavigationItem {
  id: SidebarItemId;
  label: string;
  path: string;
  icon: typeof Layout;
  iconSize: number;
  projectScoped?: boolean;
}

export const sidebarNavigation: SidebarNavigationItem[] = [
  {
    id: 'overview',
    path: '/dashboard',
    label: 'Overview',
    icon: Layout,
    iconSize: 18,
    projectScoped: true,
  },
  {
    id: 'launches',
    path: '/launches',
    label: 'Launches',
    icon: Rocket,
    iconSize: 18,
    projectScoped: true,
  },
  {
    id: 'settings',
    path: '/settings?section=general',
    label: 'Settings',
    icon: Settings,
    iconSize: 18,
  },
];
