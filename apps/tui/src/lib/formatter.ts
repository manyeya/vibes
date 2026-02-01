export type CodeBlock = {
  type: 'code';
  language: string;
  content: string;
};

export type TextBlock = {
  type: 'text';
  content: string;
};

export type ContentBlock = CodeBlock | TextBlock;

export const formatCodeBlock = (text: string): string => {
  return text;
};

export const extractCodeBlocks = (content: string): ContentBlock[] => {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks: ContentBlock[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        content: content.slice(lastIndex, match.index),
      });
    }

    blocks.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2].trim(),
    });

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: 'text',
      content: content.slice(lastIndex),
    });
  }

  return blocks;
};

export const formatBold = (text: string): string => {
  return text.replace(/\*\*(.*?)\*\*/g, (match, content) => {
    return content;
  });
};

export const formatItalic = (text: string): string => {
  return text.replace(/\*(.*?)\*/g, (match, content) => {
    return content;
  });
};
