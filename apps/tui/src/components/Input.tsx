import React, { useCallback, useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useInputHistory } from '../hooks/useInputHistory';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

const Input: React.FC<InputProps> = React.memo(({ value, onChange, onSubmit, placeholder = 'What is the vibes?', disabled = false }) => {
  const { exit } = useApp();
  const { navigateUp, navigateDown, resetNavigation, addToHistory } = useInputHistory();
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    if (!isNavigating) {
      resetNavigation();
    }
  }, [value, isNavigating, resetNavigation]);

  const handleSubmit = useCallback(() => {
    if (value.trim()) {
      onSubmit();
    }
  }, [value, onSubmit]);

  const handleInput = useCallback(async (input: string, key: any) => {
    if (disabled) return;

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.upArrow) {
      setIsNavigating(true);
      const previousInput = navigateUp(value);
      onChange(previousInput);
      return;
    }

    if (key.downArrow) {
      setIsNavigating(true);
      const nextInput = navigateDown(value);
      onChange(nextInput);
      return;
    }

    setIsNavigating(false);

    if (key.return && value.trim()) {
      handleSubmit();
    }
  }, [disabled, exit, navigateUp, navigateDown, onChange, handleSubmit]);

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
        placeholder={placeholder}
        focus={!disabled}
      />
    </Box>
  );
});

export default Input;
