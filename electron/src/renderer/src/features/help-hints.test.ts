import { describe, expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');
const root = 'src/renderer/src/features';

// DESIGN.md: an explanation sits behind the "?" beside its title, never as a paragraph under the
// control. These are the explanation keys each page has moved behind a "?". Status lines, errors,
// warnings about the current state and what the user agrees to (consent, download sizes, data
// that leaves the machine) stay visible, so they are not listed. Music Studio has its own guard
// in `music/music-help-hints.test.ts`.
const EXPLANATIONS: Record<string, string[]> = {
  'clone/action-bar.tsx': ['voiceControls.basics', 'voiceControls.hint'],
  'clone/emotion-controls.tsx': ['clone.emotion_help'],
  'clone/quality-controls.tsx': [
    'cloneQuality.hint${bits}',
    'cloneQuality.effortHint',
    'cloneQuality.masteringHint',
  ],
  'clone/reference-panel.tsx': ['profileIdentity.save_hint'],
  'clone/voice-setup.tsx': ['cloneFlow.choose_hint'],
  'dub/bgm-panel.tsx': ['dub_bgm.help'],
  'dub/casting-board.tsx': ['dub.casting_drag_hint'],
  'dub/dub-page.tsx': [
    'dub.num_speakers_help',
    'dub_hardsub.skip_asr_help',
    'dubStyle.help',
    'settings.translate_quality_desc',
    'dub.fit_speed_hint',
    'dub.voice_match_title',
    'dub.dialect_title',
    'dub.auto_glossary_title',
    'dub.reflect_title',
    'dub.condense_title',
    'dub.agent_cli_desc',
    'dub.agent_quality_desc',
  ],
  'dub/glossary-panel.tsx': ['dub.glossary_title', 'glossary.hint'],
  'dub/hardsub-panel.tsx': [
    'dub_hardsub.help',
    'dub_hardsub.region_help',
    'dub_hardsub.read_help',
    'dub_hardsub.method_${method}_help',
  ],
  'dub/paste-translation.tsx': ['dub.paste_translation_desc'],
  'longform/audiogram-panel.tsx': ['audiobook.audiogram_hint'],
  'longform/production-settings.tsx': [
    'audiobook.vary_repeats_help',
    'audiobook.joins_help',
    'audiobook.trim_edges_help',
    'audiobook.emotion_help',
  ],
  'longform/longform-page.tsx': ['audiobook.load_sample_hint'],
  'longform/story-editor.tsx': [
    'stories.autocastHint',
    'stories.splitModeHint',
    'stories.inlineVoiceHint',
    'audiobook.load_sample_hint',
  ],
  'longform/story-speed.tsx': ['stories.global_speed_hint'],
  'promo/promo-timeline.tsx': ['promo.timeline_hint'],
  'promo/scene-editor.tsx': ['promo.scene_intro', 'promo.scene_help', 'promo.scene_asset_hint'],
  'tools/convert-voice.tsx': ['convert.match_duration_hint'],
  'transcriptions/transcriptions-page.tsx': [
    'transcriptions.mode_fast_desc',
    'transcriptions.mode_accurate_desc',
  ],
  'workflows/workflow-inputs.tsx': [
    'workflowRun.normalized',
    'workflowRun.local_translation',
    'workflows.condition_hint',
    'workflowRun.scripts_hint',
  ],
  'video-editor/media-bin.tsx': ['editor.captions_hint'],
  'video-editor/properties-panel.tsx': [
    'editor.transition_hint',
    'editor.title_edit_hint',
    'editor.chroma_hint',
    'editor.duck_hint',
  ],
  'settings/aec-settings.tsx': ['dictation.aec_hint'],
  'settings/asr-openai-compat-settings.tsx': [
    'settings.asr_compat_url_hint',
    'settings.asr_compat_test_hint',
  ],
  'settings/credential-settings.tsx': ['settings.translation_providers_desc'],
  'settings/data-directory-settings.tsx': ['settings.data_directory_desc'],
  'settings/llm-providers.tsx': ['settings.llmp_desc', 'settings.llmp_provider_hint'],
  'settings/llm-skills.tsx': ['settings.llmskills_desc'],
  'settings/mcp-bindings-settings.tsx': ['settings.mcp_hint'],
  'settings/mirror-settings.tsx': ['models.mirror_description'],
  'settings/models-directory-settings.tsx': ['settings.storage_desc'],
  'settings/network-settings.tsx': ['settings.proxy_desc'],
  'settings/performance-settings.tsx': [
    'performanceProfile.hint',
    'settings.generate_budget_desc',
    'settings.offload_after_generation_note',
    'settings.compute_device_desc',
  ],
  'settings/privacy-settings.tsx': [
    'settings.history_retention_help',
    'settings.history_retention_cap_hint',
  ],
  'settings/pronunciation-settings.tsx': [
    'pronunciation.help',
    'pronunciation.lang_label',
    'pronunciation.backup_hint',
  ],
  'settings/refinement-settings.tsx': ['settings.llmskills_dictation_refinement_desc'],
  'settings/settings-page.tsx': ['settings.language_desc', 'settings.review_mode_desc'],
  'settings/shortcut-settings.tsx': ['voicePanel.mode_sub'],
  'settings/storage-settings.tsx': ['settings.storage_desc'],
  'settings/system-preflight.tsx': ['setup.system_check_desc'],
  'settings/usage-settings.tsx': ['settings.usage_desc'],
};

// What hands a string to a "?": the HelpHint itself, TitleWithHelp/DisclosureHelp, or a
// `help` prop (SettingsRow, SettingsSection, the editor's Section).
const BEHIND_HELP = /<HelpHint\b|\bhelp=\{/;

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe.each(Object.entries(EXPLANATIONS))('%s', (file, keys) => {
  const source = fs.readFileSync(`${root}/${file}`, 'utf8');
  const lines = source.split('\n');

  it.each(keys)('keeps %s behind a ?', (key) => {
    const pattern = new RegExp(`['\`]${escape(key)}['\`]`);
    const uses = lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));
    expect(uses.length, `${key} is no longer used in ${file}`).toBeGreaterThan(0);
    for (const index of uses) {
      // An accessible name is not shown text, and a confirm step repeats what the user agrees to.
      if (/aria-label=/.test(lines[index])) continue;
      if (/\{confirm && \(/.test(lines.slice(Math.max(0, index - 3), index).join('\n'))) continue;
      // The key's own line or the few above it open the "?" that holds it.
      const context = lines.slice(Math.max(0, index - 8), index + 1).join('\n');
      expect(context, `${file}:${index + 1} shows ${key} outside a ?`).toMatch(BEHIND_HELP);
      // Not a visible description or a native title tooltip.
      expect(lines[index]).not.toMatch(
        new RegExp(`\\b(description|title)=\\{[^}]*['\`]${escape(key)}['\`]`),
      );
    }
  });
});

