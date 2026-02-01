import React, { useRef, useEffect, useState, useCallback } from "react";
import { render, Text, Box, useInput, useStdout } from "ink";
import { ScrollView, ScrollViewRef } from "ink-scroll-view";
import Header from './Header.js';
import { VirtualizedMessageList } from './VirtualizedMessageList.js';
import Input from './Input.js';
import TaskPanel from './TaskPanel.js';
import { useInputHandler } from '../hooks/useInputHandler';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

const App: React.FC = () => {
  usePerformanceMonitor();
  const { input, messages, setInput, handleSubmit, handleCancel, status, error } = useInputHandler();
  const scrollRef = useRef<ScrollViewRef>(null);
  const { stdout } = useStdout();

  // Deep Agent state
  const [reasoningMode, setReasoningMode] = useState<string>('react');
  const [isProcessing, setIsProcessing] = useState(false);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lessonsLearned, setLessonsLearned] = useState<number>(0);
  const [factsStored, setFactsStored] = useState<number>(0);
  const [patternsCount, setPatternsCount] = useState<number>(0);
  const [showSidebar, setShowSidebar] = useState(true);

  // Extract agent state from messages
  useEffect(() => {
    messages.forEach((msg: any) => {
      if (msg.role === 'assistant') {
        msg.parts?.forEach((part: any) => {
          if (part.type === 'data') {
            const data = part;
            if (data.type === 'data-reasoning_mode') {
              setReasoningMode(data.data?.mode || data.mode || 'react');
            } else if (data.type === 'data-task_update') {
              const task = data.data;
              setTasks(prev => {
                const exists = prev.find(t => t.id === task.id);
                if (exists) {
                  return prev.map(t => t.id === task.id ? { ...t, ...task } : t);
                }
                return [...prev, task as Task];
              });
            } else if (data.type === 'data-status') {
              if (data.data?.message?.includes('Lesson saved')) {
                setLessonsLearned(c => c + 1);
              }
              if (data.data?.message?.includes('Fact remembered')) {
                setFactsStored(c => c + 1);
              }
              if (data.data?.message?.includes('Pattern saved')) {
                setPatternsCount(c => c + 1);
              }
            }
          }
        });
      }
    });

    // Update processing state
    setIsProcessing(status === 'streaming');

    // Estimate token count (rough estimate)
    const totalChars = messages.reduce((sum: number, msg: any) => {
      return sum + (msg.content?.length || JSON.stringify(msg).length);
    }, 0);
    setTokenCount(Math.floor(totalChars / 4)); // Rough estimate

    // Reset processing when done
    if (status === 'ready') {
      setIsProcessing(false);
    }
  }, [messages]);

  // Handle status updates from messages
  const handleStatusUpdate = useCallback((statusUpdate: { reasoningMode?: string; isProcessing?: boolean; tokenCount?: number }) => {
    if (statusUpdate.reasoningMode) setReasoningMode(statusUpdate.reasoningMode);
    if (statusUpdate.isProcessing !== undefined) setIsProcessing(statusUpdate.isProcessing);
    if (statusUpdate.tokenCount !== undefined) setTokenCount(statusUpdate.tokenCount);
  }, []);

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

    // Toggle sidebar with Ctrl+S
    if (key.ctrl && input === 's') {
      setShowSidebar(s => !s);
    }
  });

  useEffect(() => {
    scrollRef.current?.scrollToBottom();
  }, [messages]);

  return (
    <Box alignItems="center" flexDirection="row" justifyContent="space-between" width="100%" height='100%'>
      {/* Main Chat Area */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <Box paddingX={1}>
          <Header
            reasoningMode={reasoningMode}
            isProcessing={isProcessing}
            tokenCount={tokenCount}
          />
        </Box>

        {/* Scrollable Message Area */}
        <Box height={50} flexDirection="column" flexGrow={1} overflowY="hidden" position='relative'>
          <ScrollView ref={scrollRef}>
            <VirtualizedMessageList
              messages={messages}
              isLoading={status !== 'ready'}
              onStatusUpdate={handleStatusUpdate}
            />
            {error && <Text color="red">Error: {error.message}</Text>}
          </ScrollView>
        </Box>

        <Box width="100%" position="relative">
          <Input
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Type your message... (Ctrl+S to toggle sidebar)"
            disabled={status !== 'ready'}
          />
        </Box>
      </Box>

      {/* Sidebar - Task Panel */}
      {showSidebar && (
        <Box flexDirection="column" height="100%" overflowY="hidden">
          <TaskPanel
            tasks={tasks}
            lessonsLearned={lessonsLearned}
            factsStored={factsStored}
            patternsCount={patternsCount}
            agentId="default"
          />
        </Box>
      )}
    </Box>
  );
};

export default App;
