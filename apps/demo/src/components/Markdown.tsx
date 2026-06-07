import React from 'react';
import { Streamdown, type StreamdownProps, type PluginConfig } from 'streamdown';
import { code } from '@streamdown/code';

/**
 * Streamdown preconfigured with the official Shiki code-highlighter plugin.
 *
 * Streamdown v2 ships *no* default highlighter — code highlighting is a
 * pluggable `CodeHighlighterPlugin` you must supply (`@streamdown/code`).
 * Without it, fenced blocks render as uncolored fallback tokens (which is why
 * code looked monochrome). Centralised here so every markdown surface
 * highlights identically. The dual theme pairs with the class-based `dark:`
 * variant + the `@source` scan of Streamdown's dist in index.css.
 */
// `@streamdown/code` is built against a newer Streamdown whose `themes` input
// type is slightly wider than 2.1.0's, so the structurally-compatible plugin
// needs a cast to line up the published types.
const markdownPlugins: PluginConfig = { code: code as unknown as PluginConfig['code'] };

export function Markdown(props: StreamdownProps) {
  return <Streamdown plugins={markdownPlugins} {...props} />;
}
