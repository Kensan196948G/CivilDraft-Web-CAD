import { Sidebar } from 'civildraft-web-cad';
import type { AppView } from 'civildraft-web-cad';

const ALL_VIEWS: readonly AppView[] = [
  'home',
  'editor',
  'project',
  'drawingSettings',
  'survey',
  'parts',
  'quantity',
  'section',
  'steps',
  'compare',
  'approval',
  'print',
  'settings',
]

export function Default() {
  return (
    <Sidebar
      activeView="home"
      theme="light"
      implementedViews={['home', 'editor']}
      onNavigate={() => {}}
      onToggleTheme={() => {}}
    />
  )
}

export function DarkTheme() {
  return (
    <Sidebar
      activeView="editor"
      theme="dark"
      implementedViews={['home', 'editor']}
      onNavigate={() => {}}
      onToggleTheme={() => {}}
    />
  )
}

export function AllViewsImplemented() {
  return (
    <Sidebar
      activeView="quantity"
      theme="light"
      implementedViews={ALL_VIEWS}
      onNavigate={() => {}}
      onToggleTheme={() => {}}
    />
  )
}
