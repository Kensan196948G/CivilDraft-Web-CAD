import { describe, expect, it } from 'vitest'
import {
  ROLE_GROUP_NAMES,
  canApprove,
  canEdit,
  canView,
  permissionsFor,
  resolveRole,
  roleFromIdentity,
} from '@/infrastructure/auth/roles'
import type { CivilDraftRole } from '@/infrastructure/auth/roles'
import type { AccessIdentity } from '@/infrastructure/auth/accessIdentity'

describe('resolveRole', () => {
  it('civildraft-engineer → engineer', () => {
    expect(resolveRole([ROLE_GROUP_NAMES.engineer])).toBe('engineer')
  })

  it('civildraft-supervisor → supervisor', () => {
    expect(resolveRole([ROLE_GROUP_NAMES.supervisor])).toBe('supervisor')
  })

  it('civildraft-viewer → viewer', () => {
    expect(resolveRole([ROLE_GROUP_NAMES.viewer])).toBe('viewer')
  })

  it('複数グループは最上位権限を採用する（viewer+engineer+supervisor → supervisor）', () => {
    expect(
      resolveRole([ROLE_GROUP_NAMES.viewer, ROLE_GROUP_NAMES.engineer, ROLE_GROUP_NAMES.supervisor]),
    ).toBe('supervisor')
  })

  it('engineer + viewer → engineer（より上位）', () => {
    expect(resolveRole([ROLE_GROUP_NAMES.viewer, ROLE_GROUP_NAMES.engineer])).toBe('engineer')
  })

  it('未知グループのみ → viewer 既定（最小権限）', () => {
    expect(resolveRole(['some-unrelated-group', 'admins'])).toBe('viewer')
  })

  it('グループ無し（空配列）→ viewer 既定', () => {
    expect(resolveRole([])).toBe('viewer')
  })

  it('大文字・前後空白を含むグループ名も正規化して解決する', () => {
    expect(resolveRole(['  CivilDraft-Supervisor '])).toBe('supervisor')
  })
})

describe('roleFromIdentity', () => {
  it('identity の groups からロールを解決する', () => {
    const identity: AccessIdentity = {
      email: 'kantoku@example.co.jp',
      groups: [ROLE_GROUP_NAMES.supervisor],
    }
    expect(roleFromIdentity(identity)).toBe('supervisor')
  })

  it('groups が空の identity → viewer', () => {
    const identity: AccessIdentity = { email: 'guest@example.co.jp', groups: [] }
    expect(roleFromIdentity(identity)).toBe('viewer')
  })
})

describe('権限マトリクス', () => {
  const roles: CivilDraftRole[] = ['viewer', 'engineer', 'supervisor']

  it('閲覧は全ロールで許可', () => {
    for (const role of roles) expect(canView(role)).toBe(true)
  })

  it('編集は engineer / supervisor のみ許可', () => {
    expect(canEdit('viewer')).toBe(false)
    expect(canEdit('engineer')).toBe(true)
    expect(canEdit('supervisor')).toBe(true)
  })

  it('承認は supervisor のみ許可（暫定）', () => {
    expect(canApprove('viewer')).toBe(false)
    expect(canApprove('engineer')).toBe(false)
    expect(canApprove('supervisor')).toBe(true)
  })

  it('permissionsFor が各ロールの許可一式を返す', () => {
    expect(permissionsFor('viewer')).toEqual({ canView: true, canEdit: false, canApprove: false })
    expect(permissionsFor('engineer')).toEqual({ canView: true, canEdit: true, canApprove: false })
    expect(permissionsFor('supervisor')).toEqual({ canView: true, canEdit: true, canApprove: true })
  })
})
