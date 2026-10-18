import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The tool-approval panel — Claude Code style permission prompt for the DSH
 * approval seam. One pending tool call per panel: permission-colored title,
 * the tool name, the asker's reason, and Yes/No options (1/2, y/n, arrows +
 * Enter). Esc / Ctrl+C rejects (fail-closed).
 */
import React from 'react';
import { t } from '../../i18n.js';
import { Box, Text, useInput } from '../../ui.js';
import { Divider } from '../design-system/Divider.js';
import { POINTER } from '../../cc/figures.js';
export function ApprovalPanel({ snapshot, onApprove, onReject, }) {
    // 0 = allow, 1 = deny
    const [focus, setFocus] = React.useState(0);
    useInput((input, key) => {
        if (key.escape || (key.ctrl && input === 'c')) {
            onReject();
            return;
        }
        if (key.upArrow || key.downArrow || key.tab) {
            setFocus(f => (f === 0 ? 1 : 0));
            return;
        }
        if (key.return) {
            if (focus === 0)
                onApprove();
            else
                onReject();
            return;
        }
        if (input === '1' || input === 'y' || input === 'Y') {
            onApprove();
            return;
        }
        if (input === '2' || input === 'n' || input === 'N') {
            onReject();
            return;
        }
    }, { isActive: true });
    const renderOption = (index, label) => {
        const focused = index === focus;
        return (_jsxs(Box, { flexDirection: "row", marginTop: focused ? 1 : 0, children: [_jsx(Box, { width: 1, flexShrink: 0, children: _jsx(Text, { color: focused ? 'claude' : undefined, bold: focused, children: focused ? POINTER : ' ' }) }), _jsx(Box, { marginLeft: 1, children: _jsx(Text, { bold: focused, color: focused ? 'claude' : undefined, children: label }) })] }));
    };
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: "permission", bold: true, children: t('approval-title') }), _jsx(Divider, {}), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { wrap: "wrap", children: snapshot.toolName }), snapshot.reason !== undefined && snapshot.reason !== '' && (_jsx(Text, { dimColor: true, wrap: "wrap", children: snapshot.reason }))] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [renderOption(0, t('approval-allow')), renderOption(1, t('approval-deny'))] })] }));
}
