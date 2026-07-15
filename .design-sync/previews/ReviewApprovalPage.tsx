import { ReviewApprovalPage } from 'civildraft-web-cad'

export function EngineerRole() {
  return <ReviewApprovalPage initialRole="engineer" />
}

export function SupervisorRole() {
  return <ReviewApprovalPage initialRole="supervisor" />
}

export function ViewerRole() {
  return <ReviewApprovalPage initialRole="viewer" />
}
