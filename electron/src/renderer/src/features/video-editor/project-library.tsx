/**
 * The project library: every editor project, most recently opened first, to
 * open, rename, duplicate or delete, plus a new empty one.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyIcon, FolderOpenIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/features/clone/confirm-dialog';
import { cn } from '@/lib/utils';
import { recentProjects, type Library, type ProjectSummary } from './library';

export interface LibraryActions {
  open: (id: string) => void;
  create: () => void;
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
}

function Row({
  item,
  current,
  actions,
  onOpened,
}: {
  item: ProjectSummary;
  current: boolean;
  actions: LibraryActions;
  onOpened: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [confirming, setConfirming] = useState(false);
  const label = item.name.trim() || t('editor.untitled');
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(item.updatedAt);
  const commit = () => {
    setEditing(false);
    if (name !== item.name) actions.rename(item.id, name);
  };
  return (
    <li className={cn('flex items-center gap-2 rounded-lg border border-border px-3 py-2', current && 'bg-muted')}>
      {editing ? (
        <Input
          autoFocus
          className="h-8 flex-1"
          value={name}
          placeholder={t('editor.untitled')}
          aria-label={t('editor.project_name')}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setName(item.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-current={current ? 'true' : undefined}
          onClick={() => {
            actions.open(item.id);
            onOpened();
          }}
        >
          <span className="block truncate text-sm">{label}</span>
          <span className="block text-xs text-muted-foreground">
            {t(`editor.shape_${item.shape}`)} · {when}
          </span>
        </button>
      )}
      <Button size="icon-xs" variant="ghost" aria-label={t('editor.project_rename', { name: label })} onClick={() => {
          setName(item.name);
          setEditing(true);
        }}>
        <PencilIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label={t('editor.project_duplicate', { name: label })} onClick={() => actions.duplicate(item.id)}>
        <CopyIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label={t('editor.project_delete', { name: label })} onClick={() => setConfirming(true)}>
        <Trash2Icon />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('editor.project_delete_title', { name: label })}
        description={t('editor.project_delete_body')}
        confirmLabel={t('editor.delete_label')}
        cancelLabel={t('editor.cancel')}
        onConfirm={() => actions.remove(item.id)}
      />
    </li>
  );
}

export function ProjectLibrary({ library, currentId, actions }: { library: Library; currentId: string; actions: LibraryActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const projects = recentProjects(library);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <FolderOpenIcon />
        {t('editor.projects')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editor.projects')}</DialogTitle>
          <DialogDescription>{t('editor.projects_hint')}</DialogDescription>
        </DialogHeader>
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            actions.create();
            setOpen(false);
          }}
        >
          <PlusIcon />
          {t('editor.project_new')}
        </Button>
        <ul className="max-h-96 space-y-2 overflow-y-auto" aria-label={t('editor.projects')}>
          {projects.map((item) => (
            <Row key={item.id} item={item} current={item.id === currentId} actions={actions} onOpened={() => setOpen(false)} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
