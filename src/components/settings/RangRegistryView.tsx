import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Ruler, Save, Search, Trash2, X } from 'lucide-react';
import { RangEntry } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { Panel, Button, Badge, EmptyState } from '../ui';
import {
  deleteRang,
  isRangIdValid,
  normalizeRangId,
  saveRang,
  subscribeToRangs,
} from '../../services/rangService';

/**
 * Rang register.
 *
 * The two fields are the whole contract of this screen: a rang number and what
 * it is called. Everything that records a rang elsewhere in the system — the
 * cadastral register, the lease book, the assessment notices — reads from here,
 * so this is where the allowed values are decided.
 */
export const RangRegistryView: React.FC = () => {
  const { userProfile } = useAuth();
  const [rangs, setRangs] = useState<RangEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [idField, setIdField] = useState('');
  const [designation, setDesignation] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsub = subscribeToRangs((list) => {
      setRangs(list);
      setLoaded(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = setTimeout(() => setSavedFlash(null), 3500);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  const resetForm = () => {
    setIdField('');
    setDesignation('');
    setEditingId(null);
    setFormError(null);
  };

  // Compared on the canonical spelling: "012" is the same lot as "12".
  const takenIds = useMemo(() => new Set(rangs.map((r) => normalizeRangId(r.id))), [rangs]);
  const isDuplicate = !editingId && isRangIdValid(idField) && takenIds.has(normalizeRangId(idField));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!userProfile) {
      setFormError('Sign in as an administrator to edit the rang register.');
      return;
    }
    try {
      const saved = await saveRang(
        { id: idField, designation },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      setSavedFlash(editingId ? `Rang ${saved.id} updated.` : `Rang ${saved.id} added to the register.`);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save this rang.');
    }
  };

  const handleEdit = (rang: RangEntry) => {
    setEditingId(rang.id);
    setIdField(rang.id);
    setDesignation(rang.designation);
    setFormError(null);
  };

  const handleDelete = async (rang: RangEntry) => {
    if (!userProfile) return;
    if (!window.confirm(`Remove rang ${rang.id} (${rang.designation}) from the register?`)) return;
    try {
      await deleteRang(rang.id, {
        uid: userProfile.uid,
        displayName: userProfile.displayName,
        role: userProfile.role,
      });
      if (editingId === rang.id) resetForm();
      setSavedFlash(`Rang ${rang.id} removed.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not remove this rang.');
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rangs;
    return rangs.filter(
      (r) => r.id.toLowerCase().includes(q) || r.designation.toLowerCase().includes(q)
    );
  }, [rangs, search]);

  return (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-accent" />
            Rang Register
          </span>
        }
        subtitle="Cadastral lot numbers an officer may assign to a property. Every screen that records a rang draws on this list."
        padding="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[190px_1fr_auto] gap-3 md:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
                Id:
              </span>
              <input
                id="rang-id-input"
                type="text"
                inputMode="numeric"
                value={idField}
                onChange={(e) => {
                  setIdField(e.target.value.replace(/[^\d]/g, ''));
                  setFormError(null);
                }}
                readOnly={!!editingId}
                placeholder="e.g. 128"
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
                id="rang-designation-input"
                type="text"
                value={designation}
                onChange={(e) => {
                  setDesignation(e.target.value);
                  setFormError(null);
                }}
                placeholder="e.g. Rang 128 — Avenue du Lac, Quartier Les Cubi"
                className="w-full h-11 px-3 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-muted/50 focus:outline-none focus:border-accent transition-premium"
              />
            </label>

            <div className="flex items-center gap-2">
              <Button
                id="rang-save-btn"
                type="submit"
                variant="primary"
                disabled={isDuplicate}
                icon={editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              >
                {editingId ? 'Save changes' : 'Add rang'}
              </Button>
              {(editingId || idField || designation) && (
                <Button type="button" variant="ghost" size="md" onClick={resetForm} icon={<X className="w-4 h-4" />}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {editingId && (
            <p className="text-xs text-muted">
              Editing rang <span className="font-mono font-bold text-ink">{editingId}</span>. The lot
              number is locked while it is referenced by declarations.
            </p>
          )}
          {isDuplicate && (
            <p className="text-xs text-danger font-semibold">
              Rang {idField} already exists in the register. Clear the field to edit the existing
              entry from the list below instead.
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
      </Panel>

      <Panel
        title={`Registered rangs (${rangs.length})`}
        padding="none"
        actions={
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              id="rang-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52 pl-8 pr-3 rounded-[10px] border border-line bg-surface text-xs text-ink placeholder:text-muted/60 focus:outline-none focus:border-accent transition-premium"
            />
          </div>
        }
      >
        {loaded && rangs.length === 0 ? (
          <EmptyState
            icon={<Ruler className="w-5 h-5" />}
            title="No rangs registered yet"
            description="Add the cadastral lot numbers used in Goma and Karisimbi above. Until at least one exists, the property register keeps rang as a free-text entry."
            className="border-none bg-transparent"
          />
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted">
            No rang matches "{search}".
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="premium-table w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface2/60 border-b border-line">
                  <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted w-[130px]">
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
                {visible.map((rang) => (
                  <tr
                    key={rang.id}
                    className="border-b border-line/60 last:border-0 hover:bg-surface2/40 transition-premium"
                  >
                    <td className="px-6 py-3.5">
                      <Badge variant="accent" className="font-mono">
                        Rang {rang.id}
                      </Badge>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-ink">{rang.designation}</td>
                    <td className="px-6 py-3.5 text-xs text-muted">
                      <div>
                        {new Date(rang.updatedAt).toLocaleDateString('en-GB', {
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
                          onClick={() => handleEdit(rang)}
                          title="Edit designation"
                          className="p-2 rounded-[8px] text-muted hover:text-accent hover:bg-accent-soft transition-premium cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rang)}
                          title="Remove rang"
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
