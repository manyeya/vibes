import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Text } from 'ink';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" borderStyle="double" borderColor="red" padding={1}>
          <Text color="red" bold>❌ Application Error</Text>
          <Text color="red">{this.state.error?.message}</Text>
          <Text dimColor>Press Ctrl+C to exit</Text>
        </Box>
      );
    }

    return this.props.children;
  }
}
