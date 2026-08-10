import { Bell, FolderKanban, KeyRound, RefreshCw, Settings, Users, Upload } from 'lucide-react'

export const settingsSections = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'rerun', label: 'Test Rerun', icon: RefreshCw },
  { id: 'api-keys', label: 'API Keys', icon: KeyRound },
  { id: 'updates', label: 'Platform Updates', icon: Upload },
] as const

export type SettingsSectionId = (typeof settingsSections)[number]['id']

export const defaultSettingsSection: SettingsSectionId = 'general'

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return settingsSections.some((section) => section.id === value)
}
