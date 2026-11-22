import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMOTION_PRESETS, EmotionControls } from './emotion-controls';
import { cloneSettingsStore, DEFAULT_CLONE_SETTINGS } from '@/lib/store/clone-settings';

const engine = vi.hoisted(() => ({
  active: null as { supports_emotion?: boolean } | null,
}));
vi.mock('@/hooks/use-engines', () => ({ useEngines: () => ({ activeTts: engine.active }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => cloneSettingsStore.setState(() => ({ ...DEFAULT_CLONE_SETTINGS })));
afterEach(cleanup);

it.each([[undefined], [false]])('renders nothing for engines without emotion (%s)', (flag) => {
  engine.active = { supports_emotion: flag };
  const { container } = render(<EmotionControls />);
  expect(container).toBeEmptyDOMElement();
});

it('opens the emotion panel, fills a preset and clears it', async () => {
  engine.active = { supports_emotion: true };
  render(<EmotionControls />);
  fireEvent.click(screen.getByRole('button', { name: 'clone.emotion' }));

  const warm = await screen.findByRole('button', { name: 'clone.emotion_presets.warm' });
  // Strength means nothing until there is a description.
  expect(document.querySelector('[data-slot="slider"]')).toHaveAttribute('data-disabled');
  fireEvent.click(warm);
  expect(cloneSettingsStore.state.emoText).toBe(EMOTION_PRESETS[0].text);
  expect(warm).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('textbox', { name: 'audiobook.emotion_text' })).toHaveValue(
    EMOTION_PRESETS[0].text,
  );

  expect(document.querySelector('[data-slot="slider"]')).not.toHaveAttribute('data-disabled');
  fireEvent.click(screen.getByRole('button', { name: 'clone.emotion_clear' }));
  expect(cloneSettingsStore.state.emoText).toBe('');
});

it('marks the button while an emotion is set and shows strength as a share of the cap', async () => {
  engine.active = { supports_emotion: true };
  cloneSettingsStore.setState((s) => ({ ...s, emoText: 'calm', emoAlpha: 0.3 }));
  render(<EmotionControls />);
  const trigger = screen.getByRole('button', { name: 'clone.emotion: calm' });
  expect(trigger.querySelector('[data-slot="emotion-active"]')).not.toBeNull();
  fireEvent.click(trigger);
  expect(await screen.findByText('50%')).toBeInTheDocument();
});
