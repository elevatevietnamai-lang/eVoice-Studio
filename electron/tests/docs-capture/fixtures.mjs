/**
 * Demo backend state for guide screenshots. Everything here is invented: generic voice names,
 * a neutral data path and no account. Shapes follow electron/src/renderer/src/lib/api/types.ts.
 */
import { DEFAULT_FIXTURES } from '../fake-health-backend.mjs';

const DATA_DIR = 'C:\\Users\\demo\\eVoice Studio\\data';
const created = Date.UTC(2026, 10, 1) / 1000;

const voice = (id, name, language, extra = {}) => ({
  id,
  name,
  kind: 'clone',
  ref_audio_path: null,
  ref_text: null,
  instruct: null,
  language,
  seed: null,
  personality: null,
  vd_states: null,
  created_at: created,
  is_locked: false,
  image_url: null,
  audio_url: null,
  ...extra,
});

export const DEMO_PROFILES = [
  voice('demo-nam-tram', 'Giọng Nam Trầm', 'Vietnamese', {
    ref_audio_path: 'voices/demo-nam-tram.wav',
    ref_text: 'Xin chào, đây là giọng mẫu dùng cho tài liệu hướng dẫn.',
  }),
  voice('demo-nu-tin-tuc', 'Giọng Nữ Tin Tức', 'Vietnamese', {
    ref_audio_path: 'voices/demo-nu-tin-tuc.wav',
    ref_text: 'Bản tin hôm nay có ba nội dung chính.',
  }),
  voice('demo-ke-chuyen', 'Người Kể Chuyện', 'Vietnamese', {
    kind: 'design',
    instruct: 'Giọng nam trung niên, ấm, chậm rãi',
  }),
  voice('demo-narrator-en', 'English Narrator', 'English'),
];

export const DEMO_FIXTURES = {
  '/system/info': {
    ...DEFAULT_FIXTURES['/system/info'],
    data_dir: DATA_DIR,
    outputs_dir: `${DATA_DIR}\\outputs`,
  },
  '/profiles': DEMO_PROFILES,
  // One installed engine per family, so pages show their working state, not a setup notice.
  '/engines': {
    tts: {
      active: 'omnivoice',
      backends: [
        {
          id: 'omnivoice',
          display_name: 'OmniVoice',
          available: true,
          reason: null,
          supports_cloning: true,
          supports_voice_design: true,
        },
      ],
    },
    asr: {
      active: 'faster-whisper',
      backends: [
        { id: 'faster-whisper', display_name: 'Faster Whisper', available: true, reason: null },
      ],
    },
    llm: { active: '', backends: [] },
  },
};
