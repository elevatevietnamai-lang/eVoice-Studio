/**
 * Properties of the selected clip, read at the playhead. A property with
 * keyframes edits the keyframe at the playhead (adding one there); the
 * diamond adds or removes a keyframe at the playhead.
 */
import { useTranslation } from 'react-i18next';
import { DiamondIcon } from 'lucide-react';
import type { TimelineElement } from '@/lib/opencut/vendor/timeline/types';
import type { AnimationPath } from '@/lib/opencut/vendor/animation/types';
import { resolveNumberAtTime } from '@/lib/opencut/vendor/animation/values';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { FILTER_PRESETS } from '@/lib/opencut/color-filter';
import {
  DEFAULT_KEY_COLOR,
  DEFAULT_SOFTNESS,
  DEFAULT_SPILL,
  DEFAULT_THRESHOLD,
} from '@/lib/opencut/chroma-key';
import {
  EDITOR_FPS,
  EDITOR_SHAPES,
  MAIN_TRACK_ID,
  MAX_SPEED,
  MIN_SPEED,
  findElement,
  type EditorProject,
  type ElementRef,
} from './project';
import {
  TEXT_FONTS,
  hasKeyframes,
  keyframeAt,
  localTicks,
  rateOf,
  removeKeyframe,
  setKeyframe,
  setParam,
  setSourceAudio,
  setSpeed,
  setTransition,
} from './timeline-ops';
import {
  DEFAULT_TRANSITION_SECONDS,
  MAX_TRANSITION_SECONDS,
  MIN_TRANSITION_SECONDS,
  TRANSITIONS,
  placedTransitions,
  transitionOf,
} from './transitions';

export type Apply = (edit: (project: EditorProject) => EditorProject, mergeKey?: string) => void;

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].filter((speed) => speed >= MIN_SPEED && speed <= MAX_SPEED);
const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const single = (value: number | readonly number[]) => (Array.isArray(value) ? value[0] : (value as number));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-4 last:border-0">
      <h2 className="text-xs font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** A number that can be keyframed, shown as its value at the playhead. */
function KeyframedNumber({
  label,
  paths,
  element,
  selection,
  playhead,
  apply,
  min,
  max,
  step,
  display,
}: {
  label: string;
  /** One path, or several that move together (scale X and Y). */
  paths: AnimationPath[];
  element: TimelineElement;
  selection: ElementRef;
  playhead: number;
  apply: Apply;
  min: number;
  max: number;
  step: number;
  display?: (value: number) => string;
}) {
  const { t } = useTranslation();
  const [path] = paths;
  const value = resolveNumberAtTime({
    baseValue: number(element.params[path]),
    animations: element.animations,
    propertyPath: path as never,
    localTime: localTicks(element, playhead),
  });
  const keyed = hasKeyframes(element, path);
  const here = keyframeAt(element, path, playhead) !== null;
  const write = (next: number) =>
    apply(
      (project) =>
        paths.reduce(
          (current, item) =>
            keyed ? setKeyframe(current, selection, item, playhead, next) : setParam(current, selection, item, next),
          project,
        ),
      `${selection.elementId}:${path}`,
    );
  const toggleKey = () =>
    apply((project) =>
      paths.reduce(
        (current, item) =>
          here ? removeKeyframe(current, selection, item, playhead) : setKeyframe(current, selection, item, playhead, value),
        project,
      ),
    );
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">{label}</span>
        <span className="tabular-nums">{display ? display(value) : Number(value.toFixed(2))}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t(here ? 'editor.keyframe_remove' : 'editor.keyframe_add', { name: label })}
          aria-pressed={here}
          onClick={toggleKey}
        >
          <DiamondIcon className={cn(here ? 'fill-current' : keyed ? 'text-foreground' : 'text-muted-foreground')} />
        </Button>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[Math.min(max, Math.max(min, value))]}
        aria-label={label}
        onValueChange={(next) => write(single(next))}
      />
    </div>
  );
}

/** The transition from a main-track clip into the next one. */
function TransitionSettings({ project, selection, apply }: { project: EditorProject; selection: ElementRef; apply: Apply }) {
  const { t } = useTranslation();
  const found = findElement(project, selection);
  if (!found) return null;
  const chosen = transitionOf(found.element);
  const type = chosen?.type ?? 'none';
  const seconds = chosen?.seconds ?? DEFAULT_TRANSITION_SECONDS;
  const placed = placedTransitions(project.tracks.main.elements).find((item) => item.fromId === selection.elementId);
  const set = (nextType: string, nextSeconds: number, merge?: string) =>
    apply((current) => setTransition(current, selection, nextType, nextSeconds), merge);
  return (
    <Section title={t('editor.transition')}>
      <p className="text-xs text-muted-foreground">{t('editor.transition_hint')}</p>
      <div className="flex flex-wrap gap-1">
        {TRANSITIONS.map((item) => (
          <Button
            key={item}
            size="xs"
            variant={type === item ? 'secondary' : 'ghost'}
            aria-pressed={type === item}
            onClick={() => set(item, seconds)}
          >
            {t(`editor.transition_${item}`)}
          </Button>
        ))}
      </div>
      {type !== 'none' && (
        <Row label={t('editor.transition_duration', { seconds: (placed?.seconds ?? seconds).toFixed(1) })}>
          <Slider
            min={MIN_TRANSITION_SECONDS}
            max={MAX_TRANSITION_SECONDS}
            step={0.1}
            value={[seconds]}
            aria-label={t('editor.transition_duration_label')}
            onValueChange={(value) => set(type, single(value), `${selection.elementId}:transition`)}
          />
        </Row>
      )}
    </Section>
  );
}

function ProjectSettings({ project, apply }: { project: EditorProject; apply: Apply }) {
  const { t } = useTranslation();
  return (
    <Section title={t('editor.project')}>
      <Row label={t('editor.project_name')}>
        <Input
          value={project.name}
          placeholder={t('editor.untitled')}
          onChange={(event) => apply((current) => ({ ...current, name: event.target.value }), 'name')}
        />
      </Row>
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">{t('editor.format')}</p>
        <div className="flex flex-wrap gap-1">
          {EDITOR_SHAPES.map((shape) => (
            <Button
              key={shape}
              size="xs"
              variant={project.shape === shape ? 'secondary' : 'ghost'}
              aria-pressed={project.shape === shape}
              onClick={() => apply((current) => ({ ...current, shape }))}
            >
              {t(`editor.shape_${shape}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">{t('editor.fps')}</p>
        <div className="flex gap-1">
          {EDITOR_FPS.map((fps) => (
            <Button
              key={fps}
              size="xs"
              variant={project.fps === fps ? 'secondary' : 'ghost'}
              aria-pressed={project.fps === fps}
              onClick={() => apply((current) => ({ ...current, fps }))}
            >
              {fps} fps
            </Button>
          ))}
        </div>
      </div>
      <Row label={t('editor.background')}>
        <Input
          type="color"
          className="h-8 p-1"
          value={project.background}
          onChange={(event) => apply((current) => ({ ...current, background: event.target.value }), 'background')}
        />
      </Row>
    </Section>
  );
}

export function PropertiesPanel({
  project,
  selection,
  playhead,
  apply,
}: {
  project: EditorProject;
  selection: ElementRef | null;
  playhead: number;
  apply: Apply;
}) {
  const { t } = useTranslation();
  const found = findElement(project, selection);
  if (!found || !selection) return <ProjectSettings project={project} apply={apply} />;
  const { element } = found;
  const visual = element.type !== 'audio';
  const sounding = element.type === 'video' || element.type === 'audio';
  const common = { element, selection, playhead, apply };
  const main = [...project.tracks.main.elements].sort((a, b) => a.startTime - b.startTime);
  const hasNext =
    selection.trackId === MAIN_TRACK_ID && main.findIndex((item) => item.id === element.id) < main.length - 1;
  const param = (key: string, value: string | number | boolean, merge = true) =>
    apply((current) => setParam(current, selection, key, value), merge ? `${selection.elementId}:${key}` : undefined);

  return (
    <div className="space-y-4">
      {element.type === 'text' && (
        <Section title={t('editor.text')}>
          <Row label={t('editor.text_content')}>
            <Textarea
              rows={3}
              value={String(element.params.content ?? '')}
              onChange={(event) => param('content', event.target.value)}
            />
          </Row>
          <Row label={t('editor.font')}>
            <Select
              items={TEXT_FONTS.map((font) => ({ value: font, label: font.replace(' Variable', '') }))}
              value={String(element.params.fontFamily)}
              onValueChange={(value) => param('fontFamily', String(value), false)}
            >
              <SelectTrigger aria-label={t('editor.font')} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_FONTS.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font.replace(' Variable', '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t('editor.font_size')}>
            <Slider
              min={2}
              max={60}
              step={0.5}
              value={[number(element.params.fontSize, 10)]}
              aria-label={t('editor.font_size')}
              onValueChange={(value) => param('fontSize', single(value))}
            />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label={t('editor.text_color')}>
              <Input
                type="color"
                className="h-8 p-1"
                value={String(element.params.color)}
                onChange={(event) => param('color', event.target.value)}
              />
            </Row>
            <div className="flex items-end justify-between gap-2 pb-1 text-xs">
              <span className="text-muted-foreground">{t('editor.bold')}</span>
              <Switch
                aria-label={t('editor.bold')}
                checked={element.params.fontWeight === 'bold'}
                onCheckedChange={(on) => param('fontWeight', on ? 'bold' : 'normal', false)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t('editor.text_background')}</span>
            <Switch
              aria-label={t('editor.text_background')}
              checked={element.params['background.enabled'] === true}
              onCheckedChange={(on) => param('background.enabled', on, false)}
            />
          </div>
          {element.params['background.enabled'] === true && (
            <Row label={t('editor.text_background_color')}>
              <Input
                type="color"
                className="h-8 p-1"
                value={String(element.params['background.color'])}
                onChange={(event) => param('background.color', event.target.value)}
              />
            </Row>
          )}
        </Section>
      )}

      {visual && (
        <Section title={t('editor.transform')}>
          <KeyframedNumber {...common} label={t('editor.position_x')} paths={['transform.positionX']} min={-2000} max={2000} step={1} />
          <KeyframedNumber {...common} label={t('editor.position_y')} paths={['transform.positionY']} min={-2000} max={2000} step={1} />
          <KeyframedNumber
            {...common}
            label={t('editor.scale')}
            paths={['transform.scaleX', 'transform.scaleY']}
            min={0.1}
            max={4}
            step={0.01}
            display={(value) => `${Math.round(value * 100)}%`}
          />
          <KeyframedNumber {...common} label={t('editor.rotate')} paths={['transform.rotate']} min={-180} max={180} step={1} display={(value) => `${Math.round(value)}°`} />
          <KeyframedNumber
            {...common}
            label={t('editor.opacity')}
            paths={['opacity']}
            min={0}
            max={1}
            step={0.01}
            display={(value) => `${Math.round(value * 100)}%`}
          />
        </Section>
      )}

      {hasNext && <TransitionSettings project={project} selection={selection} apply={apply} />}

      {(element.type === 'video' || element.type === 'image') && (
        <Section title={t('editor.color')}>
          <div className="flex flex-wrap gap-1">
            {FILTER_PRESETS.map((preset) => {
              const active = (element.params['filter.preset'] ?? 'none') === preset;
              return (
                <Button
                  key={preset}
                  size="xs"
                  variant={active ? 'secondary' : 'ghost'}
                  aria-pressed={active}
                  onClick={() => param('filter.preset', preset, false)}
                >
                  {t(`editor.filter_${preset}`)}
                </Button>
              );
            })}
          </div>
          {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
            <Row key={key} label={`${t(`editor.${key}`)} ${Math.round(number(element.params[`filter.${key}`], 1) * 100)}%`}>
              <Slider
                min={key === 'saturation' ? 0 : 0.5}
                max={key === 'saturation' ? 2 : 1.5}
                step={0.01}
                value={[number(element.params[`filter.${key}`], 1)]}
                aria-label={t(`editor.${key}`)}
                onValueChange={(value) => param(`filter.${key}`, single(value))}
              />
            </Row>
          ))}
        </Section>
      )}

      {(element.type === 'video' || element.type === 'image') && (
        <Section title={t('editor.chroma')}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t('editor.chroma_enable')}</span>
            <Switch
              aria-label={t('editor.chroma_enable')}
              checked={element.params['chroma.enabled'] === true}
              onCheckedChange={(on) => param('chroma.enabled', on, false)}
            />
          </div>
          {element.params['chroma.enabled'] === true && (
            <>
              <p className="text-xs text-muted-foreground">{t('editor.chroma_hint')}</p>
              <div className="flex items-end gap-2">
                <Row label={t('editor.chroma_color')}>
                  <Input
                    type="color"
                    className="h-8 w-16 p-1"
                    value={String(element.params['chroma.color'] ?? DEFAULT_KEY_COLOR)}
                    onChange={(event) => param('chroma.color', event.target.value)}
                  />
                </Row>
                {(['#00ff00', '#0000ff'] as const).map((preset) => (
                  <Button
                    key={preset}
                    size="xs"
                    variant={(element.params['chroma.color'] ?? DEFAULT_KEY_COLOR) === preset ? 'secondary' : 'ghost'}
                    aria-pressed={(element.params['chroma.color'] ?? DEFAULT_KEY_COLOR) === preset}
                    onClick={() => param('chroma.color', preset, false)}
                  >
                    {t(preset === '#00ff00' ? 'editor.chroma_green' : 'editor.chroma_blue')}
                  </Button>
                ))}
              </div>
              {(
                [
                  ['threshold', DEFAULT_THRESHOLD, 0, 1],
                  ['softness', DEFAULT_SOFTNESS, 0, 0.5],
                  ['spill', DEFAULT_SPILL, 0, 1],
                ] as const
              ).map(([key, fallback, min, max]) => (
                <Row key={key} label={`${t(`editor.chroma_${key}`)} ${Math.round(number(element.params[`chroma.${key}`], fallback) * 100)}%`}>
                  <Slider
                    min={min}
                    max={max}
                    step={0.01}
                    value={[number(element.params[`chroma.${key}`], fallback)]}
                    aria-label={t(`editor.chroma_${key}`)}
                    onValueChange={(value) => param(`chroma.${key}`, single(value))}
                  />
                </Row>
              ))}
            </>
          )}
        </Section>
      )}

      {sounding && (
        <Section title={t('editor.audio')}>
          {element.type === 'video' && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t('editor.source_audio')}</span>
              <Switch
                aria-label={t('editor.source_audio')}
                checked={element.isSourceAudioEnabled !== false}
                onCheckedChange={(on) => apply((current) => setSourceAudio(current, selection, on))}
              />
            </div>
          )}
          {element.type === 'audio' && (
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('editor.duck')}</span>
                <Switch
                  aria-label={t('editor.duck')}
                  checked={element.params.duck === true}
                  onCheckedChange={(on) => param('duck', on, false)}
                />
              </div>
              <p className="text-muted-foreground">{t('editor.duck_hint')}</p>
            </div>
          )}
          <KeyframedNumber
            {...common}
            label={t('editor.volume')}
            paths={['volume']}
            min={-60}
            max={12}
            step={0.5}
            display={(value) => (value <= -60 ? t('editor.silent') : `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`)}
          />
          <Row label={t('editor.fade_in', { seconds: number(element.params.fadeIn).toFixed(1) })}>
            <Slider
              min={0}
              max={5}
              step={0.1}
              value={[number(element.params.fadeIn)]}
              aria-label={t('editor.fade_in_label')}
              onValueChange={(value) => param('fadeIn', single(value))}
            />
          </Row>
          <Row label={t('editor.fade_out', { seconds: number(element.params.fadeOut).toFixed(1) })}>
            <Slider
              min={0}
              max={5}
              step={0.1}
              value={[number(element.params.fadeOut)]}
              aria-label={t('editor.fade_out_label')}
              onValueChange={(value) => param('fadeOut', single(value))}
            />
          </Row>
          <Row label={t('editor.speed')}>
            <Select
              items={SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }))}
              value={String(rateOf(element))}
              onValueChange={(value) => apply((current) => setSpeed(current, selection, Number(value)))}
            >
              <SelectTrigger aria-label={t('editor.speed')} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((speed) => (
                  <SelectItem key={speed} value={String(speed)}>
                    {speed}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {rateOf(element) !== 1 && <p className="text-xs text-muted-foreground">{t('editor.speed_pitch')}</p>}
        </Section>
      )}
    </div>
  );
}
