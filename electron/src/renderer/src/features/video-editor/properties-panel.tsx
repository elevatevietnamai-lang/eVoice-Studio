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
import {
  EDITOR_FPS,
  EDITOR_SHAPES,
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
} from './timeline-ops';

export type Apply = (edit: (project: EditorProject) => EditorProject, mergeKey?: string) => void;

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].filter((speed) => speed >= MIN_SPEED && speed <= MAX_SPEED);
const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const single = (value: number | readonly number[]) => (Array.isArray(value) ? value[0] : (value as number));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-4 last:border-0">
      <h3 className="text-xs font-medium">{title}</h3>
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
