import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBridge } from '@/components/bridge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveAgentModel, savedAgentModel } from '@/lib/saved-agent-model';
import type { GeminiModel, RepairAgentId } from '../../../../preload/index.d';

/** The "CLI default" choice. It can never be a model id: ids start with a letter or digit. */
export const DEFAULT_MODEL = ':default';

/**
 * Models each agent offers in the dock. Claude Code takes stable aliases; Gemini's list comes
 * from `agy models` (a Google request), so it loads only when the person opens the list.
 * Agents missing here have no list to offer and run their CLI's default.
 */
export const AGENT_MODELS: Partial<Record<RepairAgentId, GeminiModel[]>> = {
  claude: [
    { id: 'opus', label: 'Claude Opus' },
    { id: 'sonnet', label: 'Claude Sonnet' },
    { id: 'haiku', label: 'Claude Haiku' },
  ],
  agy: [],
};

/** A model id read aloud until its CLI names it: `gemini-4-hydrogen-medium` → `Gemini 4 Hydrogen Medium`. */
export function readableModel(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Picks the model the selected agent runs with; the choice is saved where runs read it. */
export function AgentModelPicker({
  agent,
  disabled,
}: {
  agent: RepairAgentId;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const bridge = getBridge();
  const [model, setModel] = useState('');
  const [options, setOptions] = useState<GeminiModel[]>(AGENT_MODELS[agent] ?? []);
  const [loading, setLoading] = useState(false);
  const listed = useRef(false);

  useEffect(() => {
    let alive = true;
    listed.current = false;
    setOptions(AGENT_MODELS[agent] ?? []);
    setModel('');
    void savedAgentModel(agent).then((saved) => {
      if (alive) setModel(saved);
    });
    return () => {
      alive = false;
    };
  }, [agent]);

  if (!(agent in AGENT_MODELS)) return null;

  const loadGemini = () => {
    if (agent !== 'agy' || !bridge || listed.current) return;
    listed.current = true;
    setLoading(true);
    void bridge.repair
      .geminiStatus()
      .then((status) => {
        if (status.state === 'signedIn') setOptions(status.models);
        else listed.current = false;
      })
      .catch(() => {
        listed.current = false;
      })
      .finally(() => setLoading(false));
  };
  const choose = async (value: string) => {
    const next = value === DEFAULT_MODEL ? '' : value;
    const previous = model;
    setModel(next);
    try {
      await saveAgentModel(agent, next);
    } catch {
      setModel(previous);
    }
  };
  const defaultLabel = t('settings.gemini_model_default');
  const label = model
    ? (options.find((option) => option.id === model)?.label ?? readableModel(model))
    : defaultLabel;
  // The saved model stays choosable before Gemini's list has loaded.
  const shown =
    model && !options.some((option) => option.id === model)
      ? [{ id: model, label: readableModel(model) }, ...options]
      : options;

  return (
    <Select
      value={model || DEFAULT_MODEL}
      disabled={disabled}
      onValueChange={(value) => void choose(String(value ?? DEFAULT_MODEL))}
      onOpenChange={(open) => {
        if (open) loadGemini();
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t('agentWorkspace.model')}
        title={t('agentWorkspace.model')}
        data-slot="agent-model-picker"
        className="max-w-56 shrink-0 border-transparent bg-transparent text-xs text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground data-popup-open:bg-secondary data-popup-open:text-foreground dark:bg-transparent dark:hover:bg-secondary"
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL}>{defaultLabel}</SelectItem>
        {shown.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
        {loading && (
          <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
            {t('common.loading')}
          </p>
        )}
      </SelectContent>
    </Select>
  );
}
