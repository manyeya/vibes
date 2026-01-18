import React, { useRef, useEffect } from "react";
import { render, Text, Box, useInput, useStdout } from "ink";
import { ScrollView, ScrollViewRef } from "ink-scroll-view";
import Header from './Header.js';
import { VirtualizedMessageList } from './VirtualizedMessageList.js';
import Input from './Input.js';
import { useInputHandler } from '../hooks/useInputHandler';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';

const App: React.FC = () => {
  usePerformanceMonitor();
  const { input, messages, setInput, handleSubmit, handleCancel, status, error } = useInputHandler();
  const scrollRef = useRef<ScrollViewRef>(null);
  const { stdout } = useStdout();

  // 1. Handle Terminal Resizing due to manual window change
  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure();
    stdout?.on("resize", handleResize);
    return () => {
      stdout?.off("resize", handleResize);
    };
  }, [stdout]);

  // 2. Handle Keyboard Input
  useInput((input, key) => {
    if (key.upArrow) {
      scrollRef.current?.scrollBy(-1); // Scroll up 1 line
    }
    if (key.downArrow) {
      scrollRef.current?.scrollBy(1); // Scroll down 1 line
    }
    if (key.pageUp) {
      // Scroll up by viewport height
      const height = scrollRef.current?.getViewportHeight() || 1;
      scrollRef.current?.scrollBy(-height);
    }
    if (key.pageDown) {
      const height = scrollRef.current?.getViewportHeight() || 1;
      scrollRef.current?.scrollBy(height);
    }

    if (key.escape) {
      handleCancel();
    }
  });

  useEffect(() => {
    scrollRef.current?.scrollToBottom();
  }, [messages]);
  return (
    <Box alignItems="center" flexDirection="column" justifyContent="space-between" width="100%" height='100%'>
      <Box paddingX={1}>
        <Header />
      </Box>

      {/* Scrollable Message Area */}
      <Box height={50}  flexDirection="column" flexGrow={1} overflowY="hidden" position='relative'>
        <ScrollView ref={scrollRef}>
          <VirtualizedMessageList
            messages={messages}
            isLoading={status !== 'ready'}
          />
          {error && <Text color="red">Error: {error.message}</Text>}
        </ScrollView>
      </Box>

      <Box width="100%" position="relative" >
        <Input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type your message..."
          disabled={status !== 'ready'}
        />
      </Box>
    </Box>
  );
};

export default App;
