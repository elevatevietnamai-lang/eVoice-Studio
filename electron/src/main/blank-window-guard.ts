import type { BrowserWindow } from 'electron';
import { isTrustedRenderer } from './trusted-renderer';

const FIRST_CHECK_MS = 12_000;
const RETRY_BASE_MS = 6_000;
const HEARTBEAT_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;
const MAX_RELOADS = 3;
export const BLANK_CACHE_REPAIR_URL = 'app://voicestudio/__renderer-cache-repair';

type FallbackCopy = { title: string; retry: string };

// Generated from common.error and errors.tryAgain in the renderer catalogues.
const FALLBACK_COPY: Record<string, FallbackCopy> = {
  ar: { title: 'حدث خطأ ما', retry: 'حاول مرة أخرى' },
  de: { title: 'Etwas ist schief gelaufen', retry: 'Versuchen Sie es erneut' },
  en: { title: 'Something went wrong', retry: 'Try again' },
  es: { title: 'algo salió mal', retry: 'Inténtalo de nuevo' },
  fr: { title: "Quelque chose s'est mal passé", retry: 'Réessayez' },
  hi: { title: 'कुछ ग़लत हो गया', retry: 'पुनः प्रयास करें' },
  id: { title: 'Ada yang tidak beres', retry: 'Coba lagi' },
  it: { title: 'Qualcosa è andato storto', retry: 'Riprova' },
  ja: { title: '何か問題が発生しました', retry: 'もう一度試してください' },
  ko: { title: '문제가 발생했습니다.', retry: '다시 시도하세요' },
  nl: { title: 'Er is iets misgegaan', retry: 'Probeer het opnieuw' },
  pl: { title: 'Coś poszło nie tak', retry: 'Spróbuj ponownie' },
  pt: { title: 'Algo deu errado', retry: 'Tente novamente' },
  ru: { title: 'Что-то пошло не так', retry: 'Попробуйте еще раз' },
  sv: { title: 'Något gick fel', retry: 'Försök igen' },
  th: { title: 'มีบางอย่างผิดพลาด', retry: 'ลองอีกครั้ง' },
  tr: { title: 'Bir şeyler ters gitti', retry: 'Tekrar dene' },
  uk: { title: 'Щось пішло не так', retry: 'Спробуйте знову' },
  vi: { title: 'Đã xảy ra lỗi', retry: 'Thử lại' },
  'zh-CN': { title: '出了点问题', retry: '再试一次' },
  'zh-TW': { title: '出了點問題', retry: '再試一次' },
};

export function fallbackLocale(locale: string): string {
  const normalized = locale.replace('_', '-');
  const lower = normalized.toLowerCase();
  if (lower.startsWith('zh')) return /(?:hant|tw|hk|mo)/i.test(normalized) ? 'zh-TW' : 'zh-CN';
  const exact = Object.keys(FALLBACK_COPY).find((key) => key.toLowerCase() === lower);
  if (exact) return exact;
  const language = lower.split('-')[0];
  return Object.hasOwn(FALLBACK_COPY, language) ? language : 'en';
}

export function localizedFallbackCopy(locale: string): FallbackCopy {
  return FALLBACK_COPY[fallbackLocale(locale)] || FALLBACK_COPY.en;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// The eVoice mark, copied from `components/brand/evoice-mark.tsx` (BARS.full and SPARK): this
// page must render with no renderer bundle, so it cannot import the component. The test keeps
// the two in sync.
const MARK_BARS =
  'M101.5 44C101.5 27.984 114.484 15 130.5 15C146.516 15 159.5 27.984 159.5 44V150.171Q149.405 165.615 130.25 172Q149.405 178.385 159.5 193.829V296C159.5 312.016 146.516 325 130.5 325C114.484 325 101.5 312.016 101.5 296ZM173 120C173 103.984 185.984 91 202 91C218.016 91 231 103.984 231 120V225C231 241.016 218.016 254 202 254C185.984 254 173 241.016 173 225V193.829Q183.095 178.385 202.25 172Q183.095 165.615 173 150.171ZM30 124C30 107.984 42.984 95 59 95C75.016 95 88 107.984 88 124V215C88 231.016 75.016 244 59 244C42.984 244 30 231.016 30 215ZM244.5 161C244.5 144.984 257.484 132 273.5 132C289.516 132 302.5 144.984 302.5 161V184C302.5 200.016 289.516 213 273.5 213C257.484 213 244.5 200.016 244.5 184Z';
const MARK_SPARK =
  'M273.5 42.5Q282.5 69.5 309.5 78.5Q282.5 87.5 273.5 114.5Q264.5 87.5 237.5 78.5Q264.5 69.5 273.5 42.5Z';

// DESIGN.md dark tokens: bg #030305, surface #0d0e10, ink #f6f6f6, primary-ink #15191b,
// 12% border, card radius 12 px, control radius 8 px, 32 px button, 160 ms transitions.
const FALLBACK_STYLE = [
  'html{color-scheme:dark}',
  '*{box-sizing:border-box}',
  "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030305;color:#f6f6f6;font:14px/20px 'Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}",
  '.card{width:min(24rem,calc(100vw - 2rem));padding:2rem;text-align:center;border:1px solid rgb(246 246 246/12%);border-radius:12px;background:#0d0e10}',
  '.mark{display:block;width:48px;height:48px;margin:0 auto 1.25rem}',
  "h1{margin:0 0 1.25rem;font:600 1.125rem/1.75rem 'Space Grotesk Variable','Space Grotesk','Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}",
  'button{height:32px;padding:0 .875rem;border:0;border-radius:8px;background:#f6f6f6;color:#15191b;font:inherit;font-weight:500;cursor:pointer;box-shadow:0 1px 2px rgb(0 0 0/5%);transition:background-color 160ms cubic-bezier(.22,1,.36,1),box-shadow 160ms cubic-bezier(.22,1,.36,1)}',
  'button:hover{background:rgb(246 246 246/90%)}',
  'button:focus-visible{outline:none;box-shadow:0 0 0 3px rgb(246 246 246/50%)}',
  '@media (prefers-reduced-motion:reduce){button{transition:none}}',
].join('');

export function blankFallbackUrl(locale: string): string {
  const copy = localizedFallbackCopy(locale);
  const mark = `<svg class="mark" viewBox="0 0 340 340" aria-hidden="true"><path d="${MARK_BARS}" fill="#FFFFFF"/><path d="${MARK_SPARK}" fill="#FFFFFF"/></svg>`;
  const html = `<!doctype html><html lang="${escapeHtml(fallbackLocale(locale))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>eVoice Studio</title><style>${FALLBACK_STYLE}</style></head><body><main class="card">${mark}<h1>${escapeHtml(copy.title)}</h1><button type="button" onclick="location.replace('${BLANK_CACHE_REPAIR_URL}')">${escapeHtml(copy.retry)}</button></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function hasRenderedRoot(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return true;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(
        "Boolean(document.getElementById('root')?.childElementCount)",
        true,
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function installBlankWindowGuard(
  win: BrowserWindow,
  appUrl: string,
  locale: string,
  devOrigin?: string,
  repairCacheAndRelaunch?: () => Promise<void>,
): () => void {
  // Keep the EventEmitter reference while the window is alive. Electron's
  // `win.webContents` getter itself throws after the native window is gone.
  const contents = win.webContents;
  let timer: NodeJS.Timeout | undefined;
  let reloads = 0;
  let stopped = false;
  let showingFallback = false;
  let repairRunning = false;
  // Bumped whenever a main-frame navigation starts or commits, so a DOM probe
  // that began on an older page can never trigger recovery for a newer one.
  let generation = 0;

  const schedule = (delay: number) => {
    if (stopped || win.isDestroyed()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void inspect();
    }, delay);
  };
  const inspect = async () => {
    if (stopped || showingFallback || win.isDestroyed()) return;
    const probed = generation;
    const rendered = await hasRenderedRoot(win);
    if (stopped || win.isDestroyed() || contents.isDestroyed()) return;
    if (probed !== generation) {
      // Stale result from a superseded page. A committed navigation reschedules
      // itself; re-arm only if nothing is pending (e.g. the navigation failed).
      if (!timer && !showingFallback) schedule(RETRY_BASE_MS);
      return;
    }
    if (rendered) {
      reloads = 0;
      schedule(HEARTBEAT_MS);
      return;
    }
    reloads += 1;
    if (reloads <= MAX_RELOADS) {
      console.warn(`[window] empty renderer; reload ${reloads}/${MAX_RELOADS}`);
      void win.loadURL(appUrl).catch(() => {});
      schedule(RETRY_BASE_MS * reloads);
      return;
    }
    showingFallback = true;
    console.error('[window] renderer remained empty; showing built-in recovery');
    void win.loadURL(blankFallbackUrl(locale)).catch(() => {});
  };
  const navigationStarted = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ) => {
    if (details.isMainFrame && !details.isSameDocument) generation += 1;
  };
  const loaded = (_event: Electron.Event, url: string) => {
    generation += 1;
    if (!isTrustedRenderer(url, devOrigin)) return;
    const manualRecovery = showingFallback;
    showingFallback = false;
    if (manualRecovery) reloads = 0;
    schedule(reloads ? RETRY_BASE_MS * reloads : FIRST_CHECK_MS);
  };
  const closed = () => stop();
  const repairRequested = (event: Electron.Event, url: string) => {
    if (url !== BLANK_CACHE_REPAIR_URL) return;
    event.preventDefault();
    if (!showingFallback || repairRunning || !repairCacheAndRelaunch) return;
    repairRunning = true;
    void repairCacheAndRelaunch().catch((error) => {
      repairRunning = false;
      console.error('[window] renderer cache repair failed', error);
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (!contents.isDestroyed()) {
      contents.off('did-start-navigation', navigationStarted);
      contents.off('did-navigate', loaded);
      contents.off('will-navigate', repairRequested);
    }
    win.off('closed', closed);
  };

  contents.on('did-start-navigation', navigationStarted);
  contents.on('did-navigate', loaded);
  contents.on('will-navigate', repairRequested);
  win.on('closed', closed);
  schedule(FIRST_CHECK_MS);
  return stop;
}
