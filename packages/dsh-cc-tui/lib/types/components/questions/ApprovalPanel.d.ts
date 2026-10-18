/**
 * The tool-approval panel — Claude Code style permission prompt for the DSH
 * approval seam. One pending tool call per panel: permission-colored title,
 * the tool name, the asker's reason, and Yes/No options (1/2, y/n, arrows +
 * Enter). Esc / Ctrl+C rejects (fail-closed).
 */
import React from 'react';
export type ApprovalPanelProps = {
    readonly snapshot: {
        readonly toolName: string;
        readonly reason?: string;
    };
    readonly onApprove: () => void;
    readonly onReject: () => void;
};
export declare function ApprovalPanel({ snapshot, onApprove, onReject, }: ApprovalPanelProps): React.ReactNode;
//# sourceMappingURL=ApprovalPanel.d.ts.map