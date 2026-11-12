import {
  AudioLinesIcon,
  BlocksIcon,
  BookOpenIcon,
  ClapperboardIcon,
  FilmIcon,
  FingerprintIcon,
  FolderIcon,
  LayersIcon,
  LibraryIcon,
  MicIcon,
  MusicIcon,
  UsersRoundIcon,
  WandSparklesIcon,
  WorkflowIcon,
  WrenchIcon,
} from 'lucide-react';
import { setWorkspace } from '@/lib/store/workspace';

export type DestinationGroup = 'voice' | 'stories' | 'dub' | 'more' | 'library';

export interface WorkspaceDestination {
  to: string;
  /** Short name for the menu. */
  label: string;
  /** Full name for Home cards; the menu label is used when absent. */
  title?: string;
  /** One line under the name, in the menu and on Home. */
  description: string;
  icon: typeof AudioLinesIcon;
  group: DestinationGroup;
  /** Shown as a card on Home. */
  home?: boolean;
  /** Runs when the link is followed. */
  activate?: () => void;
}

const openSaved = () => setWorkspace({ panelCollapsed: false, libraryTab: 'voices' });

/**
 * One list for the menu and for Home, so names, order and descriptions cannot drift apart.
 * The first three entries marked `home` are Home's primary actions.
 */
export const destinations: readonly WorkspaceDestination[] = [
  {
    to: '/clone',
    label: 'nav.clone_short',
    title: 'nav.clone',
    description: 'clone.reference_hint',
    icon: FingerprintIcon,
    group: 'voice',
    home: true,
    activate: openSaved,
  },
  {
    to: '/design',
    label: 'designWorkspace.title',
    description: 'homeUi.design',
    icon: WandSparklesIcon,
    group: 'voice',
    home: true,
  },
  {
    to: '/personas',
    label: 'nav.saved',
    description: 'homeUi.saved',
    icon: UsersRoundIcon,
    group: 'voice',
    activate: openSaved,
  },
  {
    to: '/gallery',
    label: 'nav.gallery',
    description: 'gallery.subtitle',
    icon: LibraryIcon,
    group: 'voice',
    home: true,
  },
  {
    to: '/stories',
    label: 'nav.stories',
    description: 'homeUi.stories',
    icon: AudioLinesIcon,
    group: 'stories',
    home: true,
  },
  {
    to: '/audiobook',
    label: 'audiobook.title',
    description: 'homeUi.audiobook',
    icon: BookOpenIcon,
    group: 'stories',
    home: true,
  },
  {
    to: '/music',
    label: 'musicStudio.title',
    description: 'homeUi.music',
    icon: MusicIcon,
    group: 'stories',
    home: true,
  },
  {
    to: '/dub',
    label: 'dubWorkspace.title',
    description: 'homeUi.dub',
    icon: FilmIcon,
    group: 'dub',
    home: true,
  },
  {
    to: '/promo',
    label: 'promo.title',
    description: 'promo.description',
    icon: ClapperboardIcon,
    group: 'dub',
  },
  {
    to: '/batch',
    label: 'nav.batch_dub',
    description: 'homeUi.batch',
    icon: LayersIcon,
    group: 'dub',
  },
  {
    to: '/transcriptions',
    label: 'nav.transcribe',
    description: 'homeUi.transcribe',
    icon: MicIcon,
    group: 'more',
    home: true,
  },
  {
    to: '/calls',
    label: 'workflows.title',
    description: 'workflows.description',
    icon: WorkflowIcon,
    group: 'more',
    home: true,
  },
  {
    to: '/tools',
    label: 'tools.title',
    description: 'tools.desc',
    icon: WrenchIcon,
    group: 'more',
    home: true,
  },
  {
    to: '/integrations',
    label: 'integrationCatalog.title',
    description: 'integrationCatalog.description',
    icon: BlocksIcon,
    group: 'more',
  },
  {
    to: '/projects',
    label: 'projects.title',
    description: 'homeUi.projects',
    icon: FolderIcon,
    group: 'library',
  },
];

export const inGroup = (group: DestinationGroup) =>
  destinations.filter((destination) => destination.group === group);
