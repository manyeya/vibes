import React, { useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

const Input: React.FC<InputProps> = React.memo(({ value, onChange, onSubmit, placeholder = 'What is the vibes?', disabled = false }) => {
  const { exit } = useApp();

  const handleInput = useCallback(async (input: string, key: any) => {
    if (disabled) return;

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.return) {
      if (value.trim()) {
        onSubmit();
      }

    }

  }, [disabled, exit, value, onSubmit]);

  useInput(handleInput);

  return (
     <Box
        borderStyle="single"
        flexGrow={1}
        padding={1}
        borderColor="gray"
   
    >
      <Box marginRight={1}>
        <Text color="blue" bold>
          ›
        </Text>
      </Box>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={!disabled}
      />
    </Box>
  );
});

export default Input;
