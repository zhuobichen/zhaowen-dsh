/**
 * Tool-approval store — the UI-side half of the DSH approval seam
 * (`ctx.approval`). When the composed approval policy is `ask`, the harness
 * emits `approval/request` (a waterfall); the TUI registers as the
 * interactive answerer, parks each request FIFO, surfaces one at a time as
 * a Claude Code style permission prompt, and settles the harness promise
 * with an {@link ApprovalOutcome} when the user answers or the request's
 * abort signal fires (fail-closed semantics).
 */
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
/** What the TUI renders while an approval is pending. */
export interface ApprovalSnapshot {
    /** Stable key so the panel remounts (fresh selection state) per request. */
    readonly key: string;
    readonly toolName: string;
    readonly reason?: string;
    readonly callId?: string;
}
/**
 * Tool-approval store: parks requests from the approval waterfall, surfaces
 * one at a time, and settles each when the user answers or the request is
 * aborted. The TUI subscribes for re-renders and answers via
 * {@link ApprovalStore.answer}.
 */
export declare class ApprovalStore {
    private readonly queue;
    private active;
    private readonly listeners;
    private batchSeq;
    /**
     * Cached snapshot: useSyncExternalStore requires a stable reference while
     * nothing changed.
     */
    private snapshotCache;
    subscribe(listener: () => void): () => void;
    getSnapshot(): ApprovalSnapshot | null;
    /** Park a request from the `approval/request` waterfall. */
    ask(request: ApprovalRequest): Promise<ApprovalOutcome>;
    /** Answer the current approval (allowed-once / rejected). */
    answer(outcome: ApprovalOutcome): void;
    /** Settle everything (teardown): unanswered requests fail closed. */
    rejectAll(outcome?: ApprovalOutcome): void;
    private settle;
    private drain;
    private emit;
}
//# sourceMappingURL=approval.d.ts.map