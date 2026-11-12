import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CodeIcon,
  CopyPlusIcon,
  FilePlusIcon,
  FileUpIcon,
  FileDownIcon,
  FilmIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { PromoBrowserState, PromoSceneSummary } from '../../../../preload/index.d';
import { getBridge } from '@/components/bridge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeEditor, type CodeLanguage } from './code-editor';
import {
  MAX_OVERLAYS,
  SHAPE_SIZE,
  type PromoDraft,
  type PromoOverlay,
  type PromoShot,
} from './promo-model';
import { BUILTIN_SCENES, builtinScene, type BuiltinScene } from './scene-builtins';
import {
  LOGO_ID,
  assetName,
  assetProblem,
  blockingProblems,
  codeBytes,
  newParam,
  sameScene,
  SCENE_LIMITS,
  sceneShot,
  undeclaredKeys,
  validKey,
  type PromoScene,
  type PromoSceneParam,
  type PromoSceneProblem,
} from './scene-model';
import { ScenePreview } from './scene-preview';

const PREVIEW_WIDTH = { vertical: 180, square: 260, landscape: 320 } as const;
/** Error codes that get their own sentence (main/promo-ipc.ts, promo-render.ts). */
const KNOWN_ERRORS = new Set([
  'local_backend_required',
  'ffmpeg_unavailable',
  'network_blocked',
  'browser_missing',
  'logo_missing',
  'logo_too_large',
  'render_timeout',
]);

let counter = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** One line for an error, or nothing. */
function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {text}
    </p>
  );
}

function ProblemList({ problems }: { problems: readonly PromoSceneProblem[] }) {
  const { t } = useTranslation();
  if (!problems.length) return null;
  return (
    <ul className="space-y-0.5 text-xs" aria-label={t('promo.scene_problems')}>
      {problems.map((problem, index) => (
        <li
          key={index}
          className={
            problem.code === 'timer_animation' ? 'text-muted-foreground' : 'text-destructive'
          }
        >
          {t(`promo.scene_problem_${problem.code}`, {
            detail: 'detail' in problem ? problem.detail : '',
          })}
        </li>
      ))}
    </ul>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(file);
  });
}

function ParamRow({
  param,
  scene,
  logoId,
  disabled,
  onChange,
  onRemove,
}: {
  param: PromoSceneParam;
  scene: PromoScene;
  logoId: string | null;
  disabled: boolean;
  onChange: (patch: Partial<PromoSceneParam>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState(param.key);
  useEffect(() => setKey(param.key), [param.key]);
  const keyTaken = scene.params.some((other) => other !== param && other.key === key);
  const types = (['text', 'color', 'image'] as const).map((type) => ({
    value: type,
    label: t(`promo.scene_type_${type}`),
  }));
  const images = [
    { value: '', label: t('promo.scene_image_none') },
    ...(logoId ? [{ value: logoId, label: t('promo.scene_image_logo') }] : []),
    ...scene.assets
      .filter((asset) => /\.(png|jpe?g|webp|gif|svg)$/i.test(asset.name))
      .map((asset) => ({ value: `asset:${asset.name}`, label: asset.name })),
  ];
  return (
    <li className="grid grid-cols-[6rem_6rem_1fr_1.5fr_auto] items-end gap-1.5">
      <Field label={t('promo.scene_param_key')}>
        <Input
          value={key}
          disabled={disabled}
          aria-invalid={!validKey(key) || keyTaken}
          className="h-7 font-mono text-xs"
          onChange={(event) => {
            const next = event.target.value.toLowerCase();
            setKey(next);
            if (
              validKey(next) &&
              !scene.params.some((other) => other !== param && other.key === next)
            ) {
              onChange({ key: next });
            }
          }}
        />
      </Field>
      <Field label={t('promo.scene_param_type')}>
        <Select
          items={types}
          value={param.type}
          disabled={disabled}
          onValueChange={(value) => {
            const type = value as PromoSceneParam['type'];
            onChange({ type, value: type === 'color' ? '#ffffff' : '' });
          }}
        >
          <SelectTrigger aria-label={t('promo.scene_param_type')} className="h-7 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('promo.scene_param_label')}>
        <Input
          value={param.label}
          maxLength={40}
          disabled={disabled}
          className="h-7 text-xs"
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </Field>
      <Field label={t('promo.scene_param_value')}>
        {param.type === 'color' ? (
          <Input
            type="color"
            value={param.value}
            disabled={disabled}
            className="h-7 p-1"
            onChange={(event) => onChange({ value: event.target.value })}
          />
        ) : param.type === 'image' ? (
          <Select
            items={images}
            value={images.some((item) => item.value === param.value) ? param.value : ''}
            disabled={disabled}
            onValueChange={(value) => onChange({ value: String(value) })}
          >
            <SelectTrigger aria-label={t('promo.scene_param_value')} className="h-7 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {images.map((item) => (
                <SelectItem key={item.value || 'none'} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={param.value}
            maxLength={SCENE_LIMITS.text}
            disabled={disabled}
            className="h-7 text-xs"
            onChange={(event) => onChange({ value: event.target.value })}
          />
        )}
      </Field>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('promo.scene_param_remove')}
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </li>
  );
}

/** Which scene the picker shows: a built-in, a saved one, or unsaved work. */
type Source = `builtin:${BuiltinScene}` | `saved:${string}` | 'draft';

export function SceneEditor({
  draft,
  busy,
  onBusy,
  onAddOverlay,
  onAddShot,
  aiSlot,
}: {
  draft: PromoDraft;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onAddOverlay: (overlay: PromoOverlay) => void;
  onAddShot: (shot: PromoShot) => void;
  /** The AI writer, given a way to load what it wrote. */
  aiSlot?: (load: (scene: PromoScene) => void) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const bridge = getBridge();
  // Built-ins show the brand logo when it is an image main accepts for a scene.
  const logoId = draft.logo && LOGO_ID.test(draft.logo.id) ? draft.logo.id : null;
  const [scene, setScene] = useState<PromoScene>(() => builtinScene('starter', t, { logoId }));
  const [source, setSource] = useState<Source>('builtin:starter');
  const [savedCopy, setSavedCopy] = useState<PromoScene | null>(null);
  const [saved, setSaved] = useState<PromoSceneSummary[]>([]);
  const [tab, setTab] = useState<CodeLanguage>('html');
  const [preview, setPreview] = useState<string | null>(null);
  const [problems, setProblems] = useState<PromoSceneProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browser, setBrowser] = useState<PromoBrowserState | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const size = SHAPE_SIZE[draft.shape];
  const rendering = progress !== null;
  const locked = busy || rendering;

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.promo.scenes.list().then((list) => live && setSaved(list));
    void bridge.promo.browserState().then((state) => live && setBrowser(state));
    const off = bridge.promo.onBrowserState(setBrowser);
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !rendering) return;
    return bridge.promo.onRenderProgress(setProgress);
  }, [bridge, rendering]);

  const request = useMemo(() => ({ scene, ...size }), [scene, size]);
  const tooLarge = (['html', 'css', 'js'] as const).some(
    (part) => codeBytes(scene[part]) > SCENE_LIMITS.codeBytes,
  );

  // Rebuilt shortly after the last edit, in main, as one self-contained page.
  useEffect(() => {
    if (!bridge || tooLarge) return;
    let live = true;
    const timer = setTimeout(() => {
      void bridge.promo.scenes.preview(request).then((result) => {
        if (!live) return;
        setProblems(result.problems ?? []);
        if (result.ok) {
          setPreview(result.url);
          setError(null);
        } else {
          setPreview(null);
          setError(
            result.code === 'scene_problems'
              ? null
              : t('promo.scene_error_invalid', { detail: result.detail ?? result.code }),
          );
        }
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, request, tooLarge, t]);

  const shell = (children: React.ReactNode) => (
    <section className="space-y-3 rounded-(--card-radius) border border-border/60 bg-background/35 p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <CodeIcon className="size-4" />
        {t('promo.scene_title')}
      </h2>
      {children}
    </section>
  );

  if (!bridge) {
    return shell(<p className="text-xs text-muted-foreground">{t('promo.scene_desktop_only')}</p>);
  }

  const edit = (patch: Partial<PromoScene>) => {
    setScene((current) => ({ ...current, ...patch }));
    setNotice(null);
  };
  const editParam = (index: number, patch: Partial<PromoSceneParam>) =>
    edit({
      params: scene.params.map((param, at) => (at === index ? { ...param, ...patch } : param)),
    });
  const load = (next: PromoScene, from: Source) => {
    setScene(next);
    setSource(from);
    setSavedCopy(from.startsWith('saved:') ? next : null);
    setError(null);
    setNotice(null);
    setConfirmDelete(false);
  };
  const refresh = () => void bridge.promo.scenes.list().then(setSaved);

  const pick = async (value: string) => {
    if (value.startsWith('builtin:')) {
      load(builtinScene(value.slice(8) as BuiltinScene, t, { logoId }), value as Source);
    } else if (value.startsWith('saved:')) {
      const found = await bridge.promo.scenes.get(value.slice(6));
      if (found) load(found, value as Source);
    }
  };

  const save = async (copy: boolean) => {
    const result = await bridge.promo.scenes.save({ ...scene, id: copy ? null : scene.id });
    if (result.ok) {
      load(result.scene, `saved:${result.scene.id}`);
      setNotice(t('promo.scene_saved'));
      refresh();
    } else {
      setError(t('promo.scene_error_invalid', { detail: result.detail ?? result.code }));
    }
  };

  const remove = async () => {
    if (!scene.id) return;
    await bridge.promo.scenes.remove(scene.id);
    load({ ...scene, id: null }, 'draft');
    refresh();
  };

  const importFile = async () => {
    const result = await bridge.promo.scenes.importFile();
    if (result.ok) {
      load(result.scene, 'draft');
      if (result.problems.length) setNotice(t('promo.scene_import_problems'));
    } else if (result.code !== 'cancelled') {
      setError(t('promo.scene_error_invalid', { detail: result.detail ?? result.code }));
    }
  };

  const exportFile = async () => {
    const result = await bridge.promo.scenes.exportFile(scene);
    if (!result.ok && result.code !== 'cancelled') {
      setError(t('promo.scene_error_invalid', { detail: result.detail ?? result.code }));
    }
  };

  const addAsset = async (files: FileList | null) => {
    setError(null);
    const added = [...scene.assets];
    for (const file of Array.from(files ?? [])) {
      const name = assetName(file.name);
      const problem = assetProblem({ ...scene, assets: added }, name, file.size);
      if (problem) {
        setError(t(`promo.scene_asset_error_${problem}`, { name }));
        break;
      }
      added.push({ name, data: await readBase64(file) });
    }
    edit({ assets: added });
  };

  const render = async (mode: 'overlay' | 'shot') => {
    if (locked) return;
    setError(null);
    setNotice(null);
    setProgress(0);
    onBusy(true);
    try {
      const result = await bridge.promo.scenes.render({ ...request, mode }, draft.fps);
      if (result.ok) {
        if (mode === 'shot') onAddShot(sceneShot(result.media, nextKey('shot'), scene.duration));
        else
          onAddOverlay({
            key: nextKey('overlay'),
            media: result.media,
            start: 0,
            shotKey: null,
            label: scene.name,
          });
        setNotice(t(mode === 'shot' ? 'promo.scene_added_shot' : 'promo.scene_added_overlay'));
      } else if (result.code === 'scene_problems') {
        setProblems(result.problems ?? []);
      } else if (result.code !== 'cancelled') {
        setError(
          KNOWN_ERRORS.has(result.code)
            ? t(`promo.anim_error_${result.code}`)
            : t('promo.anim_error_generic', { code: result.code }),
        );
      }
    } catch (cause) {
      setError(t('promo.anim_error_generic', { code: String(cause) }));
    } finally {
      setProgress(null);
      onBusy(false);
    }
  };

  const pickerItems = [
    ...BUILTIN_SCENES.map((id) => ({
      value: `builtin:${id}`,
      label: t(`promo.scene_builtin_${id}`),
    })),
    ...saved.map((item) => ({ value: `saved:${item.id}`, label: item.name })),
    ...(source === 'draft' ? [{ value: 'draft', label: scene.name }] : []),
  ];
  const dirty = source.startsWith('saved:') && !sameScene(scene, savedCopy);
  const ready = browser?.state === 'ready';
  const blocked = blockingProblems(problems).length > 0 || tooLarge;
  const full = draft.overlays.length >= MAX_OVERLAYS;
  const missingKeys = undeclaredKeys(scene);

  return shell(
    <>
      <p className="text-xs text-muted-foreground">{t('promo.scene_intro')}</p>
      {aiSlot?.((next) => load(next, 'draft'))}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Field label={t('promo.scene_pick')}>
            <Select
              items={pickerItems}
              value={source}
              disabled={locked}
              onValueChange={(value) => void pick(String(value))}
            >
              <SelectTrigger aria-label={t('promo.scene_pick')} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('promo.scene_group_builtin')}</SelectLabel>
                  {BUILTIN_SCENES.map((id) => (
                    <SelectItem key={id} value={`builtin:${id}`}>
                      {t(`promo.scene_builtin_${id}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {saved.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t('promo.scene_group_saved')}</SelectLabel>
                    {saved.map((item) => (
                      <SelectItem key={item.id} value={`saved:${item.id}`}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {source === 'draft' && <SelectItem value="draft">{scene.name}</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked}
          onClick={() => load(builtinScene('starter', t, { logoId }), 'builtin:starter')}
        >
          <FilePlusIcon />
          {t('promo.scene_new')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={locked || blocked}
          onClick={() => void save(false)}
        >
          <SaveIcon />
          {t('promo.scene_save')}
        </Button>
        {scene.id && (
          <Button
            size="sm"
            variant="ghost"
            disabled={locked || blocked}
            onClick={() => void save(true)}
          >
            <CopyPlusIcon />
            {t('promo.scene_save_copy')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => void importFile()}>
          <FileUpIcon />
          {t('promo.scene_import')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || tooLarge}
          onClick={() => void exportFile()}
        >
          <FileDownIcon />
          {t('promo.scene_export')}
        </Button>
        {scene.id &&
          (confirmDelete ? (
            <span className="flex items-center gap-1 text-xs">
              {t('promo.scene_delete_confirm')}
              <Button size="xs" variant="destructive" onClick={() => void remove()}>
                {t('promo.scene_delete')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('promo.anim_cancel')}
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon />
              {t('promo.scene_delete')}
            </Button>
          ))}
        {dirty && <span className="text-xs text-muted-foreground">{t('promo.scene_unsaved')}</span>}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[18rem] flex-1 space-y-2">
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field label={t('promo.scene_name')}>
              <Input
                value={scene.name}
                maxLength={SCENE_LIMITS.name}
                disabled={locked}
                className="h-8"
                onChange={(event) => edit({ name: event.target.value })}
              />
            </Field>
            <Field label={t('promo.scene_length')}>
              <Input
                type="number"
                min={SCENE_LIMITS.minSeconds}
                max={SCENE_LIMITS.maxSeconds}
                step={0.5}
                value={scene.duration}
                disabled={locked}
                className="h-8"
                onChange={(event) =>
                  edit({
                    duration: Math.min(
                      SCENE_LIMITS.maxSeconds,
                      Math.max(SCENE_LIMITS.minSeconds, Number(event.target.value) || 1),
                    ),
                  })
                }
              />
            </Field>
          </div>
          <div className="flex gap-1" role="group" aria-label={t('promo.scene_code')}>
            {(['html', 'css', 'js'] as const).map((part) => (
              <Button
                key={part}
                size="xs"
                variant={tab === part ? 'secondary' : 'ghost'}
                aria-pressed={tab === part}
                onClick={() => setTab(part)}
              >
                {t(`promo.scene_tab_${part}`)}
              </Button>
            ))}
          </div>
          <CodeEditor
            key={tab}
            value={scene[tab]}
            language={tab}
            label={t(`promo.scene_tab_${tab}`)}
            disabled={locked}
            onChange={(value) => edit({ [tab]: value } as Partial<PromoScene>)}
          />
          <p className="text-xs text-muted-foreground">{t('promo.scene_help')}</p>
          {tooLarge && (
            <p className="text-xs text-destructive">
              {t('promo.scene_too_large', { max: SCENE_LIMITS.codeBytes / 1024 })}
            </p>
          )}
        </div>
        {preview && (
          <ScenePreview
            url={preview}
            duration={scene.duration}
            width={size.width}
            height={size.height}
            boxWidth={PREVIEW_WIDTH[draft.shape]}
          />
        )}
      </div>

      <ProblemList problems={problems} />

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium">{t('promo.scene_params')}</h3>
        <ul className="space-y-1.5">
          {scene.params.map((param, index) => (
            <ParamRow
              key={index}
              param={param}
              scene={scene}
              logoId={logoId}
              disabled={locked}
              onChange={(patch) => editParam(index, patch)}
              onRemove={() => edit({ params: scene.params.filter((_, at) => at !== index) })}
            />
          ))}
        </ul>
        <div className="flex flex-wrap gap-1">
          {scene.params.length < SCENE_LIMITS.params && (
            <Button
              size="xs"
              variant="ghost"
              disabled={locked}
              onClick={() => edit({ params: [...scene.params, newParam(scene, 'text')] })}
            >
              <PlusIcon />
              {t('promo.scene_param_add')}
            </Button>
          )}
          {missingKeys.slice(0, SCENE_LIMITS.params - scene.params.length).map((key) => (
            <Button
              key={key}
              size="xs"
              variant="ghost"
              disabled={locked}
              onClick={() => edit({ params: [...scene.params, newParam(scene, 'text', key)] })}
            >
              <PlusIcon />
              {t('promo.scene_param_add_key', { name: key })}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium">{t('promo.scene_assets')}</h3>
        <p className="text-xs text-muted-foreground">{t('promo.scene_asset_hint')}</p>
        {scene.assets.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {scene.assets.map((asset) => (
              <li
                key={asset.name}
                className="flex items-center gap-1 rounded-sm border border-border/60 px-1.5 py-0.5"
              >
                <span className="font-mono">assets/{asset.name}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('promo.remove')}
                  disabled={locked}
                  onClick={() => edit({ assets: scene.assets.filter((item) => item !== asset) })}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.woff2,.woff,.ttf,.otf"
          onChange={(event) => {
            void addAsset(event.target.files);
            event.target.value = '';
          }}
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={locked}
          onClick={() => fileInput.current?.click()}
        >
          <PlusIcon />
          {t('promo.scene_asset_add')}
        </Button>
      </div>

      <ErrorLine text={error} />
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {ready ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={locked || blocked || full}
            onClick={() => void render('overlay')}
          >
            {rendering ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <LayersIcon />
            )}
            {t('promo.scene_add_overlay')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={locked || blocked}
            onClick={() => void render('shot')}
          >
            <FilmIcon />
            {t('promo.scene_add_shot')}
          </Button>
          {rendering && (
            <>
              <span className="text-xs text-muted-foreground" role="status">
                {t('promo.scene_rendering', { percent: progress })}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void bridge.promo.cancelRender()}>
                <XIcon />
                {t('promo.anim_cancel')}
              </Button>
            </>
          )}
        </div>
      ) : (
        browser &&
        browser.state !== 'unsupported' && (
          <p className="text-xs text-muted-foreground">{t('promo.scene_needs_browser')}</p>
        )
      )}
    </>,
  );
}
