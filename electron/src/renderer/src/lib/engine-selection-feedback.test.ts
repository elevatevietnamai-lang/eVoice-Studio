import { describe, expect, it } from 'vitest';
import { engineSelectionFeedback } from './engine-selection-feedback';

describe('engineSelectionFeedback', () => {
  it('warns when the selected engine loses acceleration', () => {
    expect(
      engineSelectionFeedback(
        {
          active: 'omnivoice',
          routing_status: 'cpu_fallback',
          routing_reason: 'CUDA is unavailable',
        },
        'TTS',
      ),
    ).toEqual({
      tone: 'warning',
      key: 'engines.selectCpuFallback',
      values: { family: 'TTS', engine: 'omnivoice', reason: 'CUDA is unavailable' },
    });
  });

  it('surfaces an accelerated hardware caveat before generation', () => {
    expect(
      engineSelectionFeedback(
        {
          active: 'omnivoice',
          routing_status: 'accelerated',
          routing_reason: 'Long clips may exceed available VRAM',
        },
        'TTS',
      ).key,
    ).toBe('engines.selectWithCaveat');
  });

  it('keeps ordinary CPU-only selections as success', () => {
    expect(
      engineSelectionFeedback(
        { active: 'faster-whisper', routing_status: 'cpu_only', routing_reason: 'CPU engine' },
        'ASR',
      ),
    ).toEqual({
      tone: 'success',
      key: 'settings.engine_switched',
      values: { family: 'ASR', engine: 'faster-whisper' },
    });
  });

  it('shows the translated family and the engine display name, never internal ids', () => {
    expect(
      engineSelectionFeedback({ active: 'openai' }, 'Dịch thuật', 'OpenAI-compatible LLM').values,
    ).toEqual({ family: 'Dịch thuật', engine: 'OpenAI-compatible LLM' });
    expect(engineSelectionFeedback({ active: 'openai' }, 'Dịch thuật', ' ').values.engine).toBe(
      'openai',
    );
  });
});
