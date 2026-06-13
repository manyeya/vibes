import React from 'react';
import { Check, Cpu, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { ModelSelector, type ModelOption } from './chat/ModelSelector';

export type SearchProviderId = 'auto' | 'exa' | 'tavily' | 'brave';

export const SEARCH_PROVIDERS: { id: SearchProviderId; label: string; description: string }[] = [
  { id: 'auto', label: 'Auto', description: 'Use whichever provider the server has a key for.' },
  { id: 'exa', label: 'Exa', description: 'Semantic search with page contents.' },
  { id: 'tavily', label: 'Tavily', description: 'Search API tuned for LLMs.' },
  { id: 'brave', label: 'Brave', description: 'Independent web index.' },
];

interface SettingsPageProps {
  models: ModelOption[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  searchProvider: SearchProviderId;
  onSearchProviderChange: (id: SearchProviderId) => void;
}

const Section: React.FC<{
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, description, children }) => (
  <section className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-4">
    <div className="mb-3 flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-[16px] leading-tight text-[color:var(--color-ink)]">{title}</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-[color:var(--color-ink-faint)]">{description}</p>
      </div>
    </div>
    {children}
  </section>
);

/**
 * Full-page settings view reached from the right rail (#/settings). Holds
 * model + web-search defaults for now; built to grow.
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({
  models,
  selectedModel,
  onModelChange,
  searchProvider,
  onSearchProviderChange,
}) => {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <header className="mb-6">
          <h1 className="font-display text-[24px] leading-none text-[color:var(--color-ink)]">Settings</h1>
          <p className="mt-1.5 text-[13px] text-[color:var(--color-ink-soft)]">
            Defaults for new conversations. Stored locally in this browser.
          </p>
        </header>

        <div className="space-y-4">
          <Section
            icon={Cpu}
            title="Model"
            description="The default model used when you start chatting. You can still switch per session from the composer."
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-[color:var(--color-ink-soft)]">Default model</span>
              <ModelSelector models={models} value={selectedModel} onChange={onModelChange} placement="bottom" />
            </div>
          </Section>

          <Section
            icon={Globe}
            title="Web search"
            description="Which backend the webSearch tool prefers. Auto falls back to whatever the server is configured with."
          >
            <div className="space-y-1.5">
              {SEARCH_PROVIDERS.map((p) => {
                const active = p.id === searchProvider;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSearchProviderChange(p.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-[color:var(--color-line-strong)] bg-[rgba(244,238,228,0.05)]'
                        : 'border-transparent hover:bg-[rgba(244,238,228,0.03)]',
                    )}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        active ? 'text-[color:var(--color-amber)]' : 'text-transparent',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-[color:var(--color-ink)]">{p.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
                        {p.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};
