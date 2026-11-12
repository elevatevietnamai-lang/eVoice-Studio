/**
 * Utility-process entry that renders one animated template with HyperFrames.
 *
 * Runs apart from the main process so a stuck Chrome or ffmpeg never blocks
 * the UI, and so the network guard patches only this process. The parent sets
 * the Chrome, ffmpeg and cache paths in the environment (see promo-render.ts)
 * and sends one `render` message; this process answers with `progress`, then
 * `done` or `failed`, and every blocked network attempt. The parent ends this
 * process once it has the answer, so a lingering Chrome handle cannot keep it
 * alive and the answer always arrives before the exit.
 */
import {
  installChromeOfflineFlags,
  installNetworkGuard,
  type BlockedAttempt,
} from './promo-network-guard';

export type WorkerRequest = {
  type: 'render';
  projectDir: string;
  outputPath: string;
  fps: number;
  /** Transparent WebM for an overlay (default), opaque MP4 for a full-frame shot. */
  format?: 'webm' | 'mp4';
};

export type WorkerReply =
  | { type: 'progress'; progress: number }
  | { type: 'done'; blocked: BlockedAttempt[] }
  | { type: 'failed'; message: string; blocked: BlockedAttempt[] };

const blocked: BlockedAttempt[] = [];
installNetworkGuard((attempt) => blocked.push(attempt));
// Page scripts run inside Chrome, which this process's guard cannot see.
const chrome = installChromeOfflineFlags(process.env.PRODUCER_HEADLESS_SHELL_PATH ?? '');

const port = process.parentPort;

async function render(request: WorkerRequest): Promise<void> {
  // Imported after the guard so nothing in the producer runs unguarded.
  const { createRenderJob, executeRenderJob } = await import('@hyperframes/producer');
  const job = createRenderJob({
    fps: request.fps,
    quality: 'standard',
    format: request.format === 'mp4' ? 'mp4' : 'webm',
  });
  let last = -1;
  await executeRenderJob(job, request.projectDir, request.outputPath, (current) => {
    const progress = Math.max(0, Math.min(100, Math.round(current.progress)));
    if (progress !== last) {
      last = progress;
      port.postMessage({ type: 'progress', progress } satisfies WorkerReply);
    }
  });
  if (job.status !== 'complete') throw new Error(job.error ?? `render_${job.status}`);
  // Chrome started some other way would have run without the offline flags.
  if (chrome.launches() === 0) throw new Error('chrome_offline_flags_not_applied');
}

port.once('message', (event: { data: WorkerRequest }) => {
  const request = event.data;
  if (request?.type !== 'render') return;
  render(request).then(
    () => {
      port.postMessage({ type: 'done', blocked } satisfies WorkerReply);
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      port.postMessage({ type: 'failed', message, blocked } satisfies WorkerReply);
    },
  );
});
