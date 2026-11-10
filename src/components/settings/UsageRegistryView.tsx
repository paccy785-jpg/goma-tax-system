import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Shapes, Trash2, X } from 'lucide-react';
import { UsageEntry } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { Panel, Button, Badge, EmptyState } from '../ui';
import {
  deleteUsage,
  isUsageIdValid,
  saveUsage,
  subscribeToUsages,
} from '../../services/usageService';

/**
 * Usage register.
 *
 * "Add usage" opens the two fields that define a use — its code and what it is
 * called — because that is all a declared use ever is. Everything that asks what
 * a property is used for should offer this list rather than a typed box.
 */
export const UsageRegistryView: React.FC = () => {
  const { userProfile } = useAuth();
  const [usages, setUsages] = useState<UsageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [idField, setIdField] = useState('');
  const [designation, setDesignation] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToUsages((list) => {
      setUsages(list);
      setLoaded(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = setTimeout(() => setSavedFlash(null), 3500);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  const takenIds = useMemo(() => new Set(usages.map((u) => u.id)), [usages]);
  const isDuplicate = !editingId && isUsageIdValid(idField) && takenIds.has(idField.trim().toUpperCase());

  const resetForm = () => {
    setFormOpen(false);
    setIdField('');
    setDesignation('');
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!userProfile) {
      setFormError('Sign in as an administrator to edit the usage register.');
      return;
    }
    try {
      const saved = await saveUsage(
        { id: idField, designation },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      setSavedFlash(
        editingId
          ? `Usage ${saved.id} updated.`
          : `Usage ${saved.id} added to the register.`
      );
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save this usage.');
    }
  };

  const beginEdit = (usage: UsageEntry) => {
    setFormOpen(true);
    setEditingId(usage.id);
    setIdField(usage.id);
    setDesignation(usage.designation);
    setFormError(null);
  };

  const handleDelete = async (usage: UsageEntry) => {
    if (!userProfile) return;
    if (!window.confirm(`Remove usage ${usage.id} (${usage.designation}) from the register?`)) return;
    try {
      await deleteUsage(usage.id, {
        uid: userProfile.uid,
        displayName: userProfile.displayName,
        role: userProfile.role,
      });
      if (editingId === usage.id) resetForm();
      setSavedFlash(`Usage ${usage.id} removed.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not remove this usage.');
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Shapes className="w-4 h-4 text-accent" />
            Usage Register
          </span>
        }
        subtitle="The declared fiscal uses a property may be put to. Each one is a code plus the name the administration gives it."
        padding="md"
        actions={
          !formOpen ? (
            <Button
              id="add-usage-btn"
              type="button"
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setFormOpen(true);
                setFormError(null);
              }}
            >
              Add usage
            </Button>
          ) : null
        }
      >
        {formOpen ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[190px_1fr_auto] gap-3 md:items-end">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
                  Id:
                </span>
                <input
                  id="usage-id-input"
                  type="text"
                  value={idField}
                  onChange={(e) => {
                    setIdField(e.target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, ''));
                    setFormError(null);
                  }}
                  readOnly={!!editingId}
                  placeholder="e.g. COM"
                  className={`w-full h-11 px-3 rounded-[12px] border text-sm font-mono text-ink placeholder:text-muted/50 focus:outline-none transition-premium disabled:bg-surface2 disabled:text-muted ${
                    isDuplicate
                      ? 'border-danger focus:border-danger'
                      : 'border-line focus:border-accent bg-surface'
                  }`}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
                  Designation
                </span>
                <input
                  id="usage-designation-input"
                  type="text"
                  value={designation}
                  onChange={(e) => {
                    setDesignation(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="e.g. Commercial"
                  className="w-full h-11 px-3 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-muted/50 focus:outline-none focus:border-accent transition-premium"
                />
              </label>

              <div className="flex items-center gap-2">
                <Button
                  id="usage-save-btn"
                  type="submit"
                  variant="primary"
                  disabled={isDuplicate}
                  icon={editingId ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                >
                  {editingId ? 'Save changes' : 'Add usage'}
                </Button>
                <Button type="button" variant="ghost" onClick={resetForm} icon={<X className="w-4 h-4" />}>
                  Cancel
                </Button>
              </div>
            </div>

            {editingId && (
              <p className="text-xs text-muted">
                Editing usage <span className="font-mono font-bold text-ink">{editingId}</span>. The code
                stays put so declarations already filed against it keep pointing at it.
              </p>
            )}
            {isDuplicate && (
              <p className="text-xs text-danger font-semibold">
                Usage {idField} already exists in the register. Edit the existing entry from the list
                below instead.
              </p>
            )}
            {formError && (
              <div className="p-3 rounded-[10px] bg-danger/10 border border-danger/30 text-xs text-red-700 flex items-start gap-2">
                <X className="w-4 h-4 shrink-0 mt-px" />
                <span>{formError}</span>
              </div>
            )}
            {savedFlash && (
              <div className="p-3 rounded-[10px] bg-sage/15 border border-sage/30 text-xs text-sage flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {savedFlash}
              </div>
            )}
          </form>
        ) : savedFlash ? (
          <div className="p-3 rounded-[10px] bg-sage/15 border border-sage/30 text-xs text-sage flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {savedFlash}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Use <strong>Add usage</strong> to register a code and its designation. Two fields is the
            whole definition of a use.
          </p>
        )}
      </Panel>

      <Panel title={`Registered usages (${usages.length})`} padding="none">
        {!loaded ? (
          <div className="p-10 text-center text-sm text-muted">Loading the usage register…</div>
        ) : usages.length === 0 ? (
          <EmptyState
            icon={<Shapes className="w-5 h-5" />}
            title="No usages registered yet"
            description="Register the fiscal uses declared in Goma — Résidentiel, Commercial, Industriel, Agricole, Administratif and whatever else the commune levies on. Until at least one exists, the property register keeps usage a fixed pick-list."
            className="border-none bg-transparent"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface2/60 border-b border-line">
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted w-[150px]">
                    Id:
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                    Designation
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted w-[190px]">
                    Last change
                  </th>
                  <th className="px-6 py-3 w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {usages.map((usage) => (
                  <tr
                    key={usage.id}
                    className="border-b border-line/60 last:border-0 hover:bg-surface2/40 transition-premium"
                  >
                    <td className="px-6 py-3.5">
                      <Badge variant="accent" className="font-mono">
                        {usage.id}
                      </Badge>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-ink">{usage.designation}</td>
                    <td className="px-6 py-3.5 text-xs text-muted">
                      <div>
                        {new Date(usage.updatedAt).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => beginEdit(usage)}
                          title="Edit designation"
                          className="p-2 rounded-[8px] text-muted hover:text-accent hover:bg-accent-soft transition-premium cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(usage)}
                          title="Remove usage"
                          className="p-2 rounded-[8px] text-muted hover:text-danger hover:bg-danger/10 transition-premium cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
