export interface EngineSelectionResult {
  active: string;
  routing_status?: string;
  routing_reason?: string | null;
}

export interface EngineSelectionFeedback {
  tone: 'success' | 'warning';
  key: 'settings.engine_switched' | 'engines.selectCpuFallback' | 'engines.selectWithCaveat';
  values: { family: string; engine: string; reason?: string };
}

/** Interpret the backend's host-routing verdict exactly once for every engine picker.
 *
 * ``familyLabel`` and ``engineName`` are what the user reads: the translated
 * family name (``t('engineSidebar.translation')``) and the engine's display
 * name. Passing the internal family id or engine id shows "Switched
 * TRANSLATION to openai" in every language. */
export function engineSelectionFeedback(
  result: EngineSelectionResult,
  familyLabel: string,
  engineName?: string | null,
): EngineSelectionFeedback {
  const reason = result.routing_reason?.trim();
  const engine = engineName?.trim() || result.active;
  if (result.routing_status === 'cpu_fallback') {
    return {
      tone: 'warning',
      key: 'engines.selectCpuFallback',
      values: { family: familyLabel, engine, reason: reason || '' },
    };
  }
  if (result.routing_status === 'accelerated' && reason) {
    return {
      tone: 'warning',
      key: 'engines.selectWithCaveat',
      values: { family: familyLabel, engine, reason },
    };
  }
  return {
    tone: 'success',
    key: 'settings.engine_switched',
    values: { family: familyLabel, engine },
  };
}
