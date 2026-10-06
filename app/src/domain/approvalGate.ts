/** Review state is separate from the scheduler's execution state. */
export interface ApprovalTaskState {
  status: string;
  assignee?: string | null;
  block_kind?: string | null;
  result?: string | null;
  started_at?: number | null;
}

export function isAwaitingApproval(task: ApprovalTaskState): boolean {
  if (task.status !== 'blocked') return ['ready', 'todo', 'triage'].includes(task.status);
  if (task.block_kind === 'needs_input') return true;
  // Legacy drafts created blocked and unassigned have no typed block reason.
  // Never reinterpret a failed execution or a capability/dependency block.
  return !task.block_kind && !task.assignee && !task.started_at && !task.result?.trim();
}
