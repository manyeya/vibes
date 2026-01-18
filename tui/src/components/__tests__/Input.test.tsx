import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import Input from '../Input.js';

describe('Input', () => {
  const mockOnChange = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render placeholder when empty', () => {
    const { lastFrame } = render(
      <Input
        value=""
        onChange={mockOnChange}
        onSubmit={mockOnSubmit}
        placeholder="Type message..."
      />
    );

    expect(lastFrame()).toContain('Type message...');
  });

  it('should render value when not empty', () => {
    const { lastFrame } = render(
      <Input
        value="test message"
        onChange={mockOnChange}
        onSubmit={mockOnSubmit}
      />
    );

    expect(lastFrame()).toContain('test message');
  });

  it('should not call onSubmit on Enter with empty value', () => {
    const { stdin } = render(
      <Input
        value=""
        onChange={mockOnChange}
        onSubmit={mockOnSubmit}
      />
    );

    stdin.write('\n');
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should call onSubmit on Enter with non-empty value', () => {
    const { stdin } = render(
      <Input
        value="test"
        onChange={mockOnChange}
        onSubmit={mockOnSubmit}
      />
    );

    stdin.write('\n');
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('should call onChange when user types', () => {
    const { stdin } = render(
      <Input
        value=""
        onChange={mockOnChange}
        onSubmit={mockOnSubmit}
      />
    );

    stdin.write('a');
    expect(mockOnChange).toHaveBeenCalledWith('a');
  });
});
