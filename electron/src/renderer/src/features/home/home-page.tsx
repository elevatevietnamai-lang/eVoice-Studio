import { destinations } from '@/components/app-shell/destinations';
import { HomeFeatureIcon } from './home-feature-icon';
import './home-page.css';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { useProfiles } from '@/hooks/use-profiles';
import { EVoiceMark } from '@/components/brand/evoice-mark';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import { PRODUCT_NAME } from '@/lib/brand';
import { patchCloneSettings } from '@/lib/store/clone-settings';
import { selectCloneProfile } from '@/lib/store/reference';
import { blankLongformDraft, editLongform } from '@/features/longform/longform-session';
import { projectLibrary, type LongformProject } from '@/features/longform/project-library';
import { openDubProject } from '@/features/dub/dub-session';
import type { DubProject } from '@/features/projects/project-format';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api/client';
import {
  readDraft,
  replaceRecipe,
  restoreDesignProfile,
  writeDraft,
} from '@/features/design/design-draft';
import {
  ArrowRightIcon,
  AudioLinesIcon,
  BookOpenIcon,
  FilmIcon,
  FolderOpenIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ExportRecord {
  id: string;
  filename: string;
  destination_path: string;
  mode?: string;
}

const PRIMARY_ROUTES = ['/clone', '/design', '/dub'];

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: profiles = [] } = useProfiles();
  const { data: exports = [] } = useQuery({
    queryKey: ['export-history'],
    queryFn: ({ signal }) => apiJson<ExportRecord[]>('/export/history', { signal }),
    staleTime: 30_000,
  });
  const { data: dubProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: ({ signal }) => apiJson<DubProject[]>('/projects', { signal }),
  });
  const { data: longformProjects = [] } = useQuery({
    queryKey: ['longform-projects'],
    queryFn: projectLibrary.list,
  });
  const primary = PRIMARY_ROUTES.map((to) => destinations.find((entry) => entry.to === to)!);
  const homeDestinations = [
    primary,
    destinations.filter((entry) => entry.home && !PRIMARY_ROUTES.includes(entry.to)),
  ].map((group) =>
    group.map((entry) => ({
      to: entry.to,
      label: t(entry.title ?? entry.label),
      description: t(entry.description),
    })),
  );
  const recentProjects = [
    ...dubProjects.map((project) => ({
      kind: 'dub' as const,
      project,
      updatedAt:
        (project.updated_at || 0) < 1e12
          ? (project.updated_at || 0) * 1000
          : project.updated_at || 0,
    })),
    ...longformProjects.map((project) => ({
      kind: 'longform' as const,
      project,
      updatedAt: project.updatedAt,
    })),
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  const openProject = async (
    item: { kind: 'dub'; project: DubProject } | { kind: 'longform'; project: LongformProject },
  ) => {
    if (item.kind === 'dub') {
      const project = await apiJson<DubProject>('/projects/' + encodeURIComponent(item.project.id));
      if (openDubProject(project)) await navigate({ to: '/dub' });
      return;
    }
    editLongform(item.project.mode, {
      ...blankLongformDraft(),
      ...structuredClone(item.project.draft),
      projectId: item.project.id,
    });
    await navigate({
      to: item.project.mode === 'stories' ? '/stories' : '/audiobook',
    });
  };
  const useProfile = async (profile: (typeof profiles)[number]) => {
    if (profile.kind === 'design') {
      const current = readDraft();
      const restored = restoreDesignProfile(profile, current.seed);
      writeDraft(
        replaceRecipe(current, {
          attrs: restored.attrs,
          seed: restored.seed,
          profileId: restored.profileId,
        }),
      );
      patchCloneSettings({ language: restored.language });
      await navigate({ to: '/design' });
      return;
    }
    selectCloneProfile(profile);
    await navigate({ to: '/clone' });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">{t('nav.home')}</h1>
        <Link
          to="/projects"
          className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <FolderOpenIcon className="size-4" />
          {t('projects.title')}
        </Link>
      </WorkspaceHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="home-content mx-auto w-full max-w-6xl">
          <section aria-labelledby="home-new-projects">
            <FadeIn className="home-heading">
              <EVoiceMark size={56} className="home-heading-mark" />
              <h2 id="home-new-projects" className="home-heading-title" translate="no">
                {PRODUCT_NAME}
              </h2>
              <p className="home-heading-tagline">{t('homeUi.subtitle')}</p>
            </FadeIn>
            {homeDestinations.map((group, groupIndex) => (
              <Stagger
                key={groupIndex}
                className={`home-destinations grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 ${groupIndex === 0 ? 'home-destinations--primary' : 'home-destinations--secondary'}`}
              >
                {group.map(({ to, label, description }) => (
                  <StaggerItem key={to} className="min-w-0">
                  <Link
                    to={to}
                    data-destination={to}
                    className={`home-destination group ${groupIndex === 0 ? 'home-destination--primary' : 'home-destination--secondary'}`}
                  >
                    <div
                      className="home-destination-icon flex size-10 items-center justify-center rounded-lg bg-secondary text-foreground"
                    >
                      <HomeFeatureIcon destination={to} />
                    </div>
                    {groupIndex === 0 && (
                      <svg
                        className="home-card-art"
                        viewBox="0 0 160 72"
                        fill="none"
                        aria-hidden="true"
                      >
                        {to === '/clone' ? (
                          <path d="M8 36h12m8-10v20m10-32v44m10-24v4m10-30v56m10-42v28m10-36v44m10-22h12m8-10v20m10-32v44m10-24v4m10-16v28m10-18h6" />
                        ) : to === '/design' ? (
                          <>
                            <path d="M8 48c24 0 24-24 48-24s24 24 48 24 24-24 48-24" />
                            <path d="M8 32c24 0 24-12 48-12s24 40 48 40 24-40 48-40" />
                            <path d="M8 58c24 0 24-42 48-42s24 22 48 22 24-22 48-22" />
                          </>
                        ) : (
                          <>
                            <rect x="15" y="12" width="88" height="31" rx="8" />
                            <rect x="57" y="31" width="88" height="31" rx="8" />
                            <path d="M29 27h12m6 0h28m-4 19h23m6 0h29" />
                          </>
                        )}
                      </svg>
                    )}
                    <div className="home-destination-copy">
                      <h3>{label}</h3>
                      <p>{description}</p>
                    </div>
                    <ArrowRightIcon className="home-destination-arrow" aria-hidden="true" />
                  </Link>
                  </StaggerItem>
                ))}
              </Stagger>
            ))}
          </section>

          {exports.length > 0 && (
            <section className="mt-8">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <FolderOpenIcon className="size-4 text-muted-foreground" />
                  {t('projects.exports')}
                </h2>
                <Link
                  to="/projects"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('projects.all')}
                </Link>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2">
                {exports.slice(0, 4).map((record) => (
                  <Link
                    key={record.id}
                    to="/projects"
                    className="group flex min-w-0 items-center gap-3 rounded-(--card-radius) border border-border/50 bg-card/20 px-3 py-2.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FolderOpenIcon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {record.filename ||
                          record.destination_path.split(/[\\/]/).pop() ||
                          t('projects.export')}
                      </span>
                      {record.mode && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {record.mode}
                        </span>
                      )}
                    </span>
                    <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {recentProjects.length > 0 && (
            <section className="mt-8">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <FolderOpenIcon className="size-4 text-muted-foreground" />
                  {t('projects.title')}
                </h2>
                <Link
                  to="/projects"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('projects.all')}
                </Link>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2">
                {recentProjects.map((item) => {
                  const Icon =
                    item.kind === 'dub'
                      ? FilmIcon
                      : item.project.mode === 'stories'
                        ? AudioLinesIcon
                        : BookOpenIcon;
                  const label =
                    item.kind === 'dub'
                      ? t('projects.dub_projects')
                      : t(item.project.mode === 'stories' ? 'nav.stories' : 'audiobook.title');
                  return (
                    <button
                      key={item.kind + ':' + item.project.id}
                      type="button"
                      className="group flex min-w-0 items-center gap-3 rounded-(--card-radius) border border-border/50 bg-card/20 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void openProject(item)}
                    >
                      <Icon className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {item.project.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {label}
                        </span>
                      </span>
                      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {profiles.length > 0 && (
            <section className="mt-8">
              {profiles.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h2 className="text-sm font-medium">{t('clone.saved_profiles')}</h2>
                    <Link
                      to="/projects"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t('projects.all')}
                    </Link>
                  </div>
                  <div className="grid gap-1 rounded-(--card-radius) border border-border/70 bg-card/30 p-2 @3xl:grid-cols-2">
                    {profiles.slice(0, 4).map((profile) => (
                      <div
                        key={profile.id}
                        className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-accent"
                      >
                        <ProfileAvatar name={profile.name} imageUrl={profile.image_url} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {profile.name}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => void useProfile(profile)}>
                          {t('clone.select_profile')}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
