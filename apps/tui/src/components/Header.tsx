import React, { memo } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

interface HeaderProps {
  reasoningMode?: string;
  isProcessing?: boolean;
  tokenCount?: number;
}

const Header = memo(({ reasoningMode, isProcessing, tokenCount }: HeaderProps) => {
  const getModeIcon = (mode?: string) => {
    switch (mode) {
      case 'tot': return '🌳';
      case 'plan-execute': return '📋';
      case 'react': return '🔄';
      default: return '🔄';
    }
  };

  const getModeLabel = (mode?: string) => {
    switch (mode) {
      case 'tot': return 'Tree-of-Thoughts';
      case 'plan-execute': return 'Plan-Execute';
      case 'react': return 'ReAct';
      default: return 'ReAct';
    }
  };

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1} marginBottom={1}>
      <Box justifyContent="space-between" width="100%">
        <Box>
          <Gradient name="retro">
            <BigText text="Vibes" font="block" align='left' />
          </Gradient>
        </Box>
        <Box flexDirection="column" alignItems="flex-end" paddingRight={1}>
          <Text color="cyan">
            {getModeIcon(reasoningMode)} {getModeLabel(reasoningMode)}{isProcessing ? ' ●' : ''}
          </Text>
          {tokenCount !== undefined && (
            <Text color="gray" dimColor>
              Tokens: {tokenCount.toLocaleString()}
            </Text>
          )}
        </Box>
      </Box>
      <Text color="gray">Deep Agent • Planning • Reasoning • Memory • Collaboration</Text>
    </Box>
  );
});

Header.displayName = 'Header';

export default Header;
