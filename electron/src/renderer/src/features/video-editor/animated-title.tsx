/**
 * Animated titles on the timeline: the form, rendered by the desktop app's
 * Promo title renderer through its bridge. Chrome Headless Shell is only ever
 * turned on from the Promo video page; here a missing browser sends the user
 * there instead.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircleIcon, SparklesIcon } from 'lucide-react';
import type { PromoBrowserState } from '../../../../preload/index.d';
import { getBridge } from '@/components/bridge';
import { runRendererTask } from '@/lib/global-error-recovery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EditorMedia, EditorProject } from './project';
import { SHAPE_SIZE } from './project';
import {
  KNOWN_TITLE_ERRORS,
  MAX_TITLE_SECONDS,
  MIN_TITLE_SECONDS,
  TITLE_POSITIONS,
  TITLE_TEMPLATES,
  TITLE_TEMPLATE_IDS,
  defaultTitleForm,
  titleInput,
  titleProblem,
  type TitleForm,
  type TitleTemplate,
} from './title-input';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AnimatedTitleDialog({
  open,
  onOpenChange,
  project,
  initial,
  onRendered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: EditorProject;
  /** The form of a title being edited; a new title starts from the defaults. */
  initial: TitleForm | null;
  onRendered: (media: EditorMedia, form: TitleForm) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const bridge = getBridge();
  const [browser, setBrowser] = useState<PromoBrowserState | null>(null);
  const [form, setForm] = useState<TitleForm>(() => initial ?? defaultTitleForm());
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ?? defaultTitleForm());
      setError(null);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!bridge || !open) return;
    let live = true;
    void bridge.promo.browserState().then((state) => live && setBrowser(state));
    const offState = bridge.promo.onBrowserState(setBrowser);
    const offProgress = bridge.promo.onRenderProgress(setProgress);
    return () => {
      live = false;
      offState();
      offProgress();
    };
  }, [bridge, open]);

  const spec = TITLE_TEMPLATES[form.template];
  const images = project.media.filter((media) => media.kind === 'image');
  const problem = titleProblem(form);
  const rendering = progress !== null;
  const set = (patch: Partial<TitleForm>) => setForm((current) => ({ ...current, ...patch }));
  const pick = (template: TitleTemplate) =>
    set({ template, color: TITLE_TEMPLATES[template].color, glow: TITLE_TEMPLATES[template].accent });

  const render = async () => {
    if (!bridge || problem || rendering) return;
    setError(null);
    setProgress(0);
    try {
      const result = await bridge.promo.renderOverlay(titleInput(form, SHAPE_SIZE[project.shape]), project.fps);
      if (result.ok) {
        // Named after its text so the bin and timeline say which title it is.
        const name = form.title.trim() || t(`editor.title_template_${form.template}`);
        onRendered({ ...result.media, name, has_audio: false }, form);
        onOpenChange(false);
      } else if (result.code !== 'cancelled') {
        setError(
          KNOWN_TITLE_ERRORS.has(result.code)
            ? t(`editor.title_error_${result.code}`)
            : t('editor.title_error_generic', { code: result.code }),
        );
      }
    } catch (cause) {
      setError(t('editor.title_error_generic', { code: String(cause) }));
    } finally {
      setProgress(null);
    }
  };

  let body: React.ReactNode;
  if (!bridge) body = <p className="text-xs text-muted-foreground">{t('editor.title_desktop_only')}</p>;
  else if (!browser) body = <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />;
  else if (browser.state === 'unsupported') body = <p className="text-xs text-muted-foreground">{t('editor.title_unsupported')}</p>;
  else if (browser.state !== 'ready')
    body = (
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">{t('editor.title_turn_on')}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onOpenChange(false);
            runRendererTask('Open Promo video for animated titles', () => navigate({ to: '/promo' }));
          }}
        >
          {t('editor.title_open_promo')}
        </Button>
      </div>
    );
  else
    body = (
      <div className="space-y-3">
        <Field label={t('editor.title_template')}>
          <Select
            items={TITLE_TEMPLATE_IDS.map((id) => ({ value: id, label: t(`editor.title_template_${id}`) }))}
            value={form.template}
            onValueChange={(value) => pick(value as TitleTemplate)}
          >
            <SelectTrigger aria-label={t('editor.title_template')} className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TITLE_TEMPLATE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`editor.title_template_${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {spec.logo ? (
          <Field label={t('editor.title_logo')}>
            {images.length ? (
              <Select
                items={images.map((media) => ({ value: media.id, label: media.name }))}
                value={form.logoId ?? ''}
                onValueChange={(value) => set({ logoId: String(value) })}
              >
                <SelectTrigger aria-label={t('editor.title_logo')} className="h-8 w-full">
                  <SelectValue placeholder={t('editor.title_logo_pick')} />
                </SelectTrigger>
                <SelectContent>
                  {images.map((media) => (
                    <SelectItem key={media.id} value={media.id}>
                      {media.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-muted-foreground">{t('editor.title_logo_needed')}</p>
            )}
          </Field>
        ) : null}
        <Field label={t(spec.logo ? 'editor.title_text_optional' : 'editor.title_text')}>
          <Input value={form.title} maxLength={120} onChange={(event) => set({ title: event.target.value })} />
        </Field>
        {spec.lines ? (
          form.lines.map((line, index) => (
            <Field key={index} label={t('editor.title_line', { number: index + 1 })}>
              <Input
                value={line}
                maxLength={80}
                onChange={(event) => set({ lines: form.lines.map((item, at) => (at === index ? event.target.value : item)) })}
              />
            </Field>
          ))
        ) : (
          <Field label={t('editor.title_subtitle')}>
            <Input value={form.subtitle} maxLength={120} onChange={(event) => set({ subtitle: event.target.value })} />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('editor.title_color')}>
            <Input type="color" className="h-8 p-1" value={form.color} onChange={(event) => set({ color: event.target.value })} />
          </Field>
          <Field label={t('editor.title_accent')}>
            <Input type="color" className="h-8 p-1" value={form.glow} onChange={(event) => set({ glow: event.target.value })} />
          </Field>
          <Field label={t('editor.title_seconds')}>
            <Input
              type="number"
              className="h-8"
              min={MIN_TITLE_SECONDS}
              max={MAX_TITLE_SECONDS}
              step={0.5}
              value={form.seconds}
              onChange={(event) => set({ seconds: Number(event.target.value) || MIN_TITLE_SECONDS })}
            />
          </Field>
        </div>
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">{t('editor.title_position')}</p>
          <div className="grid w-36 grid-cols-3 gap-1">
            {TITLE_POSITIONS.map((position) => (
              <Button
                key={position}
                size="xs"
                variant={form.position === position ? 'secondary' : 'ghost'}
                aria-pressed={form.position === position}
                aria-label={t(`editor.title_pos_${position}`)}
                onClick={() => set({ position })}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
              </Button>
            ))}
          </div>
        </div>
        <div role="alert" className="empty:hidden">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        {rendering ? (
          <div className="flex items-center gap-2">
            <Progress value={Math.round(progress ?? 0)} className="flex-1" aria-label={t('editor.title_rendering')} />
            <span className="w-9 text-xs tabular-nums text-muted-foreground">{Math.round(progress ?? 0)}%</span>
            <Button size="sm" variant="ghost" onClick={() => void bridge.promo.cancelRender()}>
              {t('editor.cancel')}
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={!!problem} onClick={() => void render()}>
            <SparklesIcon />
            {t(initial ? 'editor.title_render_again' : 'editor.title_render')}
          </Button>
        )}
      </div>
    );

  return (
    <Dialog open={open} onOpenChange={(next) => !rendering && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editor.title_dialog')}</DialogTitle>
          <DialogDescription>{t('editor.title_hint')}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
