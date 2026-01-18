import React, { memo } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

const Header = memo(() => {
  return (
    <Box flexDirection="column" paddingX={0} marginTop={1} marginBottom={1}>
      <Box>
        <Gradient name="retro">
          <BigText text="The Vibes" font="block" align='left' />
        </Gradient>
      </Box>
      <Text color="gray"> AI Coding Assistant</Text>
    </Box>
  );
});

Header.displayName = 'Header';

export default Header;
