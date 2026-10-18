/**
 * Tool-approval store — the UI-side half of the DSH approval seam
 * (`ctx.approval`). When the composed approval policy is `ask`, the harness
 * emits `approval/request` (a waterfall); the TUI registers as the
 * interactive answerer, parks each request FIFO, surfaces one at a time as
 * a Claude Code style permission prompt, and settles the harness promise
 * with an {@link ApprovalOutcome} when the user answers or the request's
 * abort signal fires (fail-closed semantics).
 */

import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** One queued or active approval request. */
interface PendingApproval {
  readonly request: ApprovalRequest
  readonly batchId: number
  resolve: (outcome: ApprovalOutcome) => void
}

/** What the TUI renders while an approval is pending. */
export interface ApprovalSnapshot {
  /** Stable key so the panel remounts (fresh selection state) per request. */
  readonly key: string
  readonly toolName: string
  readonly reason?: string
  readonly callId?: string
}

/**
 * Tool-approval store: parks requests from the approval waterfall, surfaces
 * one at a time, and settles each when the user answers or the request is
 * aborted. The TUI subscribes for re-renders and answers via
 * {@link ApprovalStore.answer}.
 */
export class ApprovalStore {
  private readonly queue: PendingApproval[] = []
  private active: PendingApproval | undefined
  private readonly listeners = new Set<() => void>()
  private batchSeq = 0
  /**
   * Cached snapshot: useSyncExternalStore requires a stable reference while
   * nothing changed.
   */
  private snapshotCache: ApprovalSnapshot | null = null

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): ApprovalSnapshot | null {
    if (this.active === undefined) {
      if (this.snapshotCache !== null) this.snapshotCache = null
      return null
    }
    if (this.snapshotCache === null) {
      this.snapshotCache = {
        key: `approval-${this.active.batchId}`,
        toolName: this.active.request.toolName,
        reason: this.active.request.reason,
        callId: this.active.request.callId,
      }
    }
    return this.snapshotCache
  }

  /** Park a request from the `approval/request` waterfall. */
  ask(request: ApprovalRequest): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = { request, batchId: this.batchSeq++, resolve }
      this.queue.push(pending)
      this.emit()
      if (this.active === undefined) this.drain()
      request.signal?.addEventListener('abort', () => {
        if (this.active === pending) {
          this.settle('cancelled')
        } else {
          const idx = this.queue.indexOf(pending)
          if (idx !== -1) this.queue.splice(idx, 1)
          resolve('cancelled')
        }
      })
    })
  }

  /** Answer the current approval (allowed-once / rejected). */
  answer(outcome: ApprovalOutcome): void {
    if (this.active !== undefined) this.settle(outcome)
  }

  /** Settle everything (teardown): unanswered requests fail closed. */
  rejectAll(outcome: ApprovalOutcome = 'cancelled'): void {
    if (this.active !== undefined) this.settle(outcome)
    for (const pending of this.queue.splice(0)) pending.resolve(outcome)
  }

  private settle(outcome: ApprovalOutcome): void {
    if (this.active === undefined) return
    const pending = this.active
    this.active = undefined
    this.snapshotCache = null
    pending.resolve(outcome)
    this.emit()
    this.drain()
  }

  private drain(): void {
    if (this.active !== undefined) return
    const next = this.queue.shift()
    if (next === undefined) return
    this.active = next
    this.snapshotCache = null
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
