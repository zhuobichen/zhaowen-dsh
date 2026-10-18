/**
 * The tool-approval panel — Claude Code style permission prompt for the DSH
 * approval seam. One pending tool call per panel: permission-colored title,
 * the tool name, the asker's reason, and Yes/No options (1/2, y/n, arrows +
 * Enter). Esc / Ctrl+C rejects (fail-closed).
 */

import React from 'react'
import { t } from '../../i18n.js'
import { Box, Text, useInput } from '../../ui.js'
import { Divider } from '../design-system/Divider.js'
import { POINTER } from '../../cc/figures.js'

export type ApprovalPanelProps = {
  readonly snapshot: {
    readonly toolName: string
    readonly reason?: string
  }
  readonly onApprove: () => void
  readonly onReject: () => void
}

export function ApprovalPanel({
  snapshot,
  onApprove,
  onReject,
}: ApprovalPanelProps): React.ReactNode {
  // 0 = allow, 1 = deny
  const [focus, setFocus] = React.useState(0)

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onReject()
      return
    }
    if (key.upArrow || key.downArrow || key.tab) {
      setFocus(f => (f === 0 ? 1 : 0))
      return
    }
    if (key.return) {
      if (focus === 0) onApprove()
      else onReject()
      return
    }
    if (input === '1' || input === 'y' || input === 'Y') {
      onApprove()
      return
    }
    if (input === '2' || input === 'n' || input === 'N') {
      onReject()
      return
    }
  }, { isActive: true })

  const renderOption = (index: number, label: string): React.ReactNode => {
    const focused = index === focus
    return (
      <Box flexDirection="row" marginTop={focused ? 1 : 0}>
        <Box width={1} flexShrink={0}>
          <Text color={focused ? 'claude' : undefined} bold={focused}>
            {focused ? POINTER : ' '}
          </Text>
        </Box>
        <Box marginLeft={1}>
          <Text bold={focused} color={focused ? 'claude' : undefined}>{label}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="permission" bold>{t('approval-title')}</Text>
      <Divider />
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="wrap">{snapshot.toolName}</Text>
        {snapshot.reason !== undefined && snapshot.reason !== '' && (
          <Text dimColor wrap="wrap">{snapshot.reason}</Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {renderOption(0, t('approval-allow'))}
        {renderOption(1, t('approval-deny'))}
      </Box>
    </Box>
  )
}
