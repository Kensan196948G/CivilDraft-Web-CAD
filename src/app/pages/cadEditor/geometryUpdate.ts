/**
 * 図形更新時の updatedAt 付与ヘルパー（Issue #179 で CadEditorPage から抽出）。
 * react-refresh の都合上、コンポーネントファイルとは分離して定義する。
 */
import type { Geometry } from '@/shared/types'

export function withUpdatedAt<T extends Geometry>(geometry: T, patch: Partial<T>): T {
  return { ...geometry, ...patch, updatedAt: new Date().toISOString() }
}
