import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PresetVoicePicker } from './preset-voice-picker';
import { cloneSettingsStore, DEFAULT_CLONE_SETTINGS } from '@/lib/store/clone-settings';

const engine = vi.hoisted(() => ({
  active: null as { preset_voices?: string[]; default_voice?: string | null } | null,
}));
vi.mock('@/hooks/use-engines', () => ({ useEngines: () => ({ activeTts: engine.active }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => cloneSettingsStore.setState(() => ({ ...DEFAULT_CLONE_SETTINGS })));
afterEach(cleanup);

it('lists the engine presets and stores the pick (#2938)', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
  engine.active = { preset_voices: ['M1', 'F3'], default_voice: 'M1' };
  render(<PresetVoicePicker />);
  const trigger = screen.getByRole('combobox', { name: 'presetVoice.label' });
  expect(trigger).toHaveTextContent('M1');
  fireEvent.click(trigger);
  expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['M1', 'F3']);
  const f3 = screen.getByRole('option', { name: 'F3' });
  fireEvent.pointerDown(f3, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseDown(f3, { button: 0 });
  fireEvent.pointerUp(f3, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseUp(f3, { button: 0 });
  fireEvent.click(f3);
  await waitFor(() => expect(cloneSettingsStore.state.presetVoice).toBe('F3'));
});

it('renders nothing for engines without presets', () => {
  engine.active = { preset_voices: [] };
  const { container } = render(<PresetVoicePicker />);
  expect(container).toBeEmptyDOMElement();
});
