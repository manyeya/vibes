import React from 'react';
import {
  OpenAI,
  Anthropic,
  Gemini,
  Qwen,
  Meta,
  Mistral,
  DeepSeek,
  Kimi,
  Nvidia,
  Zhipu,
  Microsoft,
} from '@lobehub/icons';

// Brand avatars keyed by the model-id provider prefix (the part before "/").
// Avatars sit the glyph on a brand-colored tile, so they stay legible on the
// dark surface even for brands whose mono mark is near-black (OpenAI, Anthropic).
const AVATARS: Record<string, React.ComponentType<any>> = {
  openai: OpenAI.Avatar,
  anthropic: Anthropic.Avatar,
  google: Gemini.Avatar,
  qwen: Qwen.Avatar,
  meta: Meta.Avatar,
  'meta-llama': Meta.Avatar,
  mistralai: Mistral.Avatar,
  deepseek: DeepSeek.Avatar,
  moonshotai: Kimi.Avatar,
  nvidia: Nvidia.Avatar,
  'z-ai': Zhipu.Avatar,
  microsoft: Microsoft.Avatar,
};

export function providerKey(modelId?: string): string {
  return modelId?.split('/')[0]?.toLowerCase() ?? '';
}

interface ProviderLogoProps {
  /** Model id (e.g. "qwen/qwen3-coder:free") — the prefix selects the brand. */
  modelId?: string;
  /** Fallback label (provider/group) used for the monogram tile. */
  label?: string;
  size?: number;
}

/**
 * The brand logo for a model's provider. Falls back to a neutral monogram tile
 * for providers the icon set doesn't cover, so the (live, changing) catalog
 * never renders a hole.
 */
export const ProviderLogo: React.FC<ProviderLogoProps> = ({ modelId, label, size = 18 }) => {
  const Avatar = AVATARS[providerKey(modelId)];
  if (Avatar) return <Avatar size={size} shape="square" />;

  const letter = (label || providerKey(modelId) || '?').charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-[rgba(244,238,228,0.08)] font-mono text-[10px] text-[color:var(--color-ink-soft)]"
    >
      {letter}
    </span>
  );
};
