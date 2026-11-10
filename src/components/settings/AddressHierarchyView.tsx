import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  AddressLevel,
  AddressPath,
  AddressRegistry,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Button, EmptyState, MetricStrip, Panel } from '../ui';
import {
  ADDRESS_LEVEL_META,
  ADDRESS_LEVELS,
  AddressNode,
  addAddressNode,
  childLevelOf,
  countAddressTree,
  describeAddressPath,
  levelOfPath,
  optionsUnder,
  removeAddressNode,
  renameAddressNode,
  subscribeToAddressRegistry,
  subtreeCounts,
} from '../../services/addressService';

/** Does this node, or anything nested under it, match the search? */
function nodeMatchesSearch(registry: AddressRegistry, path: AddressPath, q: string): boolean {
  const parent = path.length === 1 ? registry.villes : optionsUnder(registry, path.slice(0, -1));
  const node = parent.find((n) => n.id === path[path.length - 1]);
  if (!node) return false;
  if (node.id.toLowerCase().includes(q) || node.name.toLowerCase().includes(q)) return true;
  // A parent stays visible while any descendant matches, or the search would
  // hide the very branch it just told the user about.
  return optionsUnder(registry, path).some((child) =>
    nodeMatchesSearch(registry, [...path, child.id], q)
  );
}

/**
 * The address hierarchy editor.
 *
 * One card per level, nested: a ville contains its communes, a commune its
 * quartiers, a quartier its avenues. Adding at any depth asks only for a name:
 * the service derives the code from that name, so an ID can never be typed by
 * hand or collide with a sibling.
 */
export const AddressHierarchyView: React.FC = () => {
  const { userProfile } = useAuth();
  const [registry, setRegistry] = useState<AddressRegistry | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<AddressPath | null>(null);
  const [renamingPath, setRenamingPath] = useState<AddressPath | null>(null);
  const [nameField, setNameField] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => subscribeToAddressRegistry(setRegistry), []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  const actor = useMemo(
    () =>
      userProfile
        ? { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
        : null,
    [userProfile]
  );

  const counts = useMemo(
    () => countAddressTree(registry || ({ villes: [] } as unknown as AddressRegistry)),
    [registry]
  );

  const q = search.trim().toLowerCase();
  const matchesQuery = (path: AddressPath): boolean => {
    if (!registry || !q) return true;
    return nodeMatchesSearch(registry, path, q);
  };

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const beginAdd = (parentPath: AddressPath) => {
    setAddingUnder(parentPath);
    setRenamingPath(null);
    setNameField('');
    setError(null);
    if (parentPath.length) {
      setExpanded((prev) => new Set(prev).add(parentPath.join('/')));
    }
  };

  const cancelForm = () => {
    setAddingUnder(null);
    setRenamingPath(null);
    setNameField('');
    setError(null);
  };

  const submitAdd = async (parentPath: AddressPath) => {
    if (!actor) return;
    const level = childLevelOf(parentPath);
    if (!level) return;
    setError(null);
    try {
      if (!nameField.trim()) {
        throw new Error(`${ADDRESS_LEVEL_META[level].label} name is required.`);
      }
      await addAddressNode(parentPath, { name: nameField }, actor);
      setFlash(
        parentPath.length
          ? `${ADDRESS_LEVEL_META[level].label} added under ${describeAddressPath(registry!, parentPath)}.`
          : `${ADDRESS_LEVEL_META[level].label} added.`
      );
      setAddingUnder(null);
      setNameField('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this address.');
    }
  };

  const submitRename = async (path: AddressPath) => {
    if (!actor) return;
    try {
      await renameAddressNode(path, nameField, actor);
      setFlash(`${ADDRESS_LEVEL_META[levelOfPath(path)].label} renamed.`);
      setRenamingPath(null);
      setNameField('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename this address.');
    }
  };

  /** Is `candidate` the node at `base`, or a descendant of it? */
  const isSameOrDescendant = (candidate: AddressPath, base: AddressPath): boolean =>
    candidate.length >= base.length && base.every((segment, i) => candidate[i] === segment);

  const submitDelete = async (path: AddressPath) => {
    if (!actor || !registry) return;
    const sub = subtreeCounts(registry, path);
    const cascade = [
      sub.communes ? `${sub.communes} commune(s)` : '',
      sub.quartiers ? `${sub.quartiers} quartier(s)` : '',
      sub.avenues ? `${sub.avenues} avenue(s)` : '',
    ].filter(Boolean);
    const label = describeAddressPath(registry, path);
    const warning = cascade.length
      ? `\n\nThis also removes: ${cascade.join(', ')}.`
      : '';
    if (!window.confirm(`Remove ${label}?${warning}\n\nExisting declarations that use this address keep the text they were filed with.`)) {
      return;
    }
    setBusy(true);
    try {
      await removeAddressNode(path, actor);
      setFlash(`Removed ${label}.`);
      if (addingUnder && isSameOrDescendant(addingUnder, path)) setAddingUnder(null);
      if (renamingPath && isSameOrDescendant(renamingPath, path)) setRenamingPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this address.');
    } finally {
      setBusy(false);
    }
  };

  /** Shared row used for adding (name only) and for renaming. */
  const renderForm = (
    targetPath: AddressPath,
    mode: 'add' | 'rename',
    level: AddressLevel
  ) => {
    const key = `${mode}:${targetPath.join('/')}`;
    const meta = ADDRESS_LEVEL_META[level];
    return (
      <div
        key={key}
        className="mt-2.5 mb-1 p-3 rounded-[12px] border border-accent/30 bg-accent-soft/25 flex flex-col sm:flex-row sm:items-end gap-2.5 animate-in fade-in slide-in-from-top-1 duration-150"
      >
        <label className="block flex-1">
          <span className="mb-1 flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Nom {meta.label.toLowerCase()}:
            {mode === 'add' && (
              <span className="font-medium normal-case tracking-normal text-muted/70">
                ID auto-généré
              </span>
            )}
          </span>
          <input
            autoFocus
            value={nameField}
            onChange={(e) => {
              setNameField(e.target.value);
              setError(null);
            }}
            placeholder={
              level === 'ville'
                ? 'e.g. Goma'
                : level === 'commune'
                ? 'e.g. Commune de Goma'
                : level === 'quartier'
                ? 'e.g. Les Cubi'
                : 'e.g. Avenue du Lac'
            }
            className="w-full h-10 px-3 rounded-[10px] border border-line bg-surface text-sm text-ink placeholder:text-muted/50 focus:outline-none focus:border-accent transition-premium"
          />
        </label>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => (mode === 'add' ? submitAdd(targetPath) : submitRename(targetPath))}
            icon={mode === 'add' ? <Plus className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          >
            {mode === 'add' ? `Add ${meta.label.toLowerCase()}` : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={cancelForm}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const renderNode = (
    node: AddressNode,
    path: AddressPath,
    level: AddressLevel
  ): React.ReactNode => {
    const key = path.join('/');
    const childLevel = childLevelOf(path);
    const children = childLevel ? optionsUnder(registry!, path) : [];
    const hasChildren = children.length > 0;
    const isOpen = expanded.has(key) || (!!q && matchesQuery(path));
    const isRenaming = renamingPath?.join('/') === key;
    const isAddingHere = addingUnder && addingUnder.join('/') === key;

    return (
      <div key={key} className="relative">
        <div
          className="group flex items-center gap-2 py-2 rounded-[10px] hover:bg-surface2/50 transition-premium"
          style={{ paddingLeft: `${(path.length - 1) * 6}px` }}
        >
          {hasChildren || childLevel ? (
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              className="w-6 h-6 flex items-center justify-center rounded-[6px] text-muted hover:text-accent hover:bg-accent-soft cursor-pointer shrink-0"
            >
              {hasChildren ? (
                isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <span className="w-1 h-1 rounded-full bg-line" />
              )}
            </button>
          ) : null}

          <Badge variant={level === 'ville' ? 'accent' : level === 'commune' ? 'sage' : 'neutral'} className="font-mono shrink-0">
            {node.id}
          </Badge>

          {isRenaming ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                autoFocus
                value={nameField}
                onChange={(e) => setNameField(e.target.value)}
                className="h-9 flex-1 px-3 rounded-[10px] border border-accent bg-surface text-sm text-ink focus:outline-none transition-premium"
              />
              <Button type="button" size="sm" onClick={() => submitRename(path)}>
                Save
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={cancelForm}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-ink truncate">{node.name}</span>
              <span className="ml-2 text-[11px] uppercase tracking-[0.1em] text-muted/70 hidden sm:inline">
                {ADDRESS_LEVEL_META[level].alsoKnownAs}
              </span>
              {hasChildren && (
                <span className="ml-2 text-[12px] text-muted">
                  {children.length} {ADDRESS_LEVEL_META[childLevelOf(path)!].plural.toLowerCase()}
                </span>
              )}
            </div>
          )}

          {!isRenaming && (
            <div className="flex items-center gap-1 shrink-0">
              {childLevel && (
                <button
                  type="button"
                  onClick={() => (isAddingHere ? cancelForm() : beginAdd(path))}
                  title={`Add a ${ADDRESS_LEVEL_META[childLevel].label.toLowerCase()} under ${node.name}`}
                  className="px-2 py-1.5 rounded-[8px] text-[12px] font-bold text-accent hover:bg-accent-soft transition-premium cursor-pointer"
                >
                  + {ADDRESS_LEVEL_META[childLevel].label}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRenamingPath(path);
                  setAddingUnder(null);
                  setNameField(node.name);
                  setError(null);
                }}
                title="Rename"
                className="p-1.5 rounded-[8px] text-muted hover:text-accent hover:bg-accent-soft transition-premium cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => submitDelete(path)}
                title="Remove"
                className="p-1.5 rounded-[8px] text-muted hover:text-danger hover:bg-danger/10 transition-premium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {isAddingHere && childLevel && renderForm(path, 'add', childLevel)}

        {isOpen && hasChildren && (
          <div className="ml-[13px] pl-3.5 border-l border-line/70 space-y-0.5">
            {children
              .filter((child) => matchesQuery([...path, child.id]))
              .map((child) => renderNode(child, [...path, child.id], childLevelOf(path)!))}
          </div>
        )}
      </div>
    );
  };

  const villes = registry?.villes || [];
  const addingAtRoot = addingUnder !== null && addingUnder.length === 0;

  return (
    <div className="space-y-5">
      <MetricStrip
        columns={4}
        items={[
          { label: 'Villes', value: counts.villes, subline: 'ville / territoire', icon: <MapPin className="w-4 h-4" />, trendType: 'sage' },
          { label: 'Communes', value: counts.communes, subline: 'commune / chefferie', trendType: 'muted' },
          { label: 'Quartiers', value: counts.quartiers, subline: 'quartier / groupement', trendType: 'muted' },
          { label: 'Avenues', value: counts.avenues, subline: 'avenue / localité', trendType: 'muted' },
        ]}
      />

      <Panel
        title={
          <span className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-accent" />
            Hiérarchie d’adresse
          </span>
        }
        subtitle="Chaque adresse du système se rattache ici : ville › commune › quartier › avenue. Une fiche d’identification ou une parcelle mal orthographiée ne peut plus se glisser dans le registre."
        padding="md"
        actions={
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              id="address-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-48 sm:w-60 pl-8 pr-3 rounded-[10px] border border-line bg-surface text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent transition-premium"
            />
          </div>
        }
      >
        {/* Root action: the tree always starts with a ville. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 pb-2">
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
              Villes ({villes.length})
            </span>
            {!addingAtRoot && (
              <Button
                id="add-ville-btn"
                type="button"
                size="sm"
                variant="ghost"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => beginAdd([])}
              >
                Add ville
              </Button>
            )}
          </div>

          {addingAtRoot && renderForm([], 'add', 'ville')}

          {error && (
            <div className="my-2 p-3 rounded-[10px] bg-danger/10 border border-danger/30 text-xs text-red-700 flex items-start gap-2">
              <X className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}
          {flash && (
            <div className="mb-2 p-3 rounded-[10px] bg-sage/15 border border-sage/30 text-xs text-sage flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {flash}
            </div>
          )}

          {!registry ? (
            <div className="py-8 text-center text-sm text-muted">Loading the address hierarchy…</div>
          ) : villes.length === 0 && !addingAtRoot ? (
            <EmptyState
              icon={<MapPin className="w-5 h-5" />}
              title="No ville registered yet"
              description="Add the first ville, then hang its communes, quartiers and avenues beneath it. Every address field in the system will draw its options from this tree."
              actionLabel="Add ville"
              onAction={() => beginAdd([])}
              className="border-none bg-transparent"
            />
          ) : (
            <div className="space-y-0.5">
              {villes
                .filter((ville) => matchesQuery([ville.id]))
                .map((ville) => renderNode(ville, [ville.id], 'ville'))}
              {q && villes.filter((v) => matchesQuery([v.id])).length === 0 && (
                <div className="py-6 text-center text-sm text-muted">
                  Nothing in the hierarchy matches “{search}”.
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <p className="text-[12px] text-muted leading-relaxed max-w-3xl">
        Removing a node never rewrites declarations already filed with it — the
        historical text stays on the record, which is what an assessment notice
        has to be able to do. {ADDRESS_LEVELS.length} levels deep is the whole
        DPRNK address grammar: nothing in Goma sits outside a ville, a commune, a
        quartier and an avenue.
      </p>
    </div>
  );
};
