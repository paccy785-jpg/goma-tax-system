import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  AddressAvenue,
  AddressCommune,
  AddressLevel,
  AddressPath,
  AddressQuartier,
  AddressRegistry,
  AddressVille,
  UserRole,
} from '../types';
import { logAuditEvent } from './dbService';

/**
 * The administrative address tree: ville → commune → quartier → avenue.
 *
 * Lives as one document in the `settings` collection rather than its own
 * collection, because it is configuration at exactly the same authority level as
 * the role-permission matrix that already lives there — and the whole tree is
 * always read together, so there is nothing to gain from splitting it.
 */
export const ADDRESS_REGISTRY_DOC = 'addressHierarchy';

export const ADDRESS_LEVELS: AddressLevel[] = ['ville', 'commune', 'quartier', 'avenue'];

interface LevelMeta {
  /** Label for a single node at this level. */
  label: string;
  /** Label for the collection of nodes at this level. */
  plural: string;
  /** The French administrative alternate shown as guidance. */
  alsoKnownAs: string;
  /** Key holding this level inside the registry root, or inside a parent node. */
  childrenKey: 'villes' | 'communes' | 'quartiers' | 'avenues';
}

export const ADDRESS_LEVEL_META: Record<AddressLevel, LevelMeta> = {
  ville: { label: 'Ville', plural: 'Villes', alsoKnownAs: 'ville / territoire', childrenKey: 'villes' },
  commune: { label: 'Commune', plural: 'Communes', alsoKnownAs: 'commune / chefferie', childrenKey: 'communes' },
  quartier: { label: 'Quartier', plural: 'Quartiers', alsoKnownAs: 'quartier / groupement', childrenKey: 'quartiers' },
  avenue: { label: 'Avenue', plural: 'Avenues', alsoKnownAs: 'avenue / localité', childrenKey: 'avenues' },
};

/** A node at any level, once read out of the tree. */
export type AddressNode = AddressVille | AddressCommune | AddressQuartier | AddressAvenue;

export function emptyAddressRegistry(): AddressRegistry {
  return { id: ADDRESS_REGISTRY_DOC, villes: [], updatedAt: new Date(0).toISOString() };
}

export function levelOfPath(path: AddressPath): AddressLevel {
  return ADDRESS_LEVELS[Math.min(path.length - 1, ADDRESS_LEVELS.length - 1)];
}

/** The level a new child of `path` would belong to; null below the deepest level. */
export function childLevelOf(path: AddressPath): AddressLevel | null {
  const next = path.length;
  return next < ADDRESS_LEVELS.length ? ADDRESS_LEVELS[next] : null;
}

function childrenArray(node: AddressNode, level: AddressLevel): AddressNode[] {
  if (level === 'ville') return (node as AddressVille).communes;
  if (level === 'commune') return (node as AddressCommune).quartiers;
  if (level === 'quartier') return (node as AddressQuartier).avenues;
  return [];
}

/**
 * Rebuild one node with its children mapped, at whatever level it sits.
 * Every tree walk in this file is "descend, transform, rebuild" — this is the
 * rebuild half, kept in one place so no branch forgets a level.
 *
 * The casts are load-bearing but safe: a walk never converts a commune into a
 * quartier, so the element type of each child list is preserved by construction
 * even though `AddressNode` is too wide for the compiler to notice.
 */
function mapChildren(
  node: AddressNode,
  level: AddressLevel,
  fn: (children: AddressNode[]) => AddressNode[]
): AddressNode {
  if (level === 'ville') {
    const ville = node as AddressVille;
    return { ...ville, communes: fn(ville.communes) as AddressCommune[] };
  }
  if (level === 'commune') {
    const commune = node as AddressCommune;
    return { ...commune, quartiers: fn(commune.quartiers) as AddressQuartier[] };
  }
  if (level === 'quartier') {
    const quartier = node as AddressQuartier;
    return { ...quartier, avenues: fn(quartier.avenues) as AddressAvenue[] };
  }
  return node;
}

/**
 * Read the node at `path`. An empty path returns the registry's villes list as
 * the addressable root, which is what lets a caller treat "add a ville" and
 * "add an avenue under three parents" through the same code.
 */
export function getNode(registry: AddressRegistry, path: AddressPath): AddressNode | AddressNode[] | null {
  let level: AddressLevel = 'ville';
  let current: AddressNode[] | AddressNode = registry.villes;

  for (let i = 0; i < path.length; i++) {
    const list = Array.isArray(current) ? current : childrenArray(current as AddressNode, level);
    const found = list.find((n) => n.id === path[i]);
    if (!found) return null;
    current = found;
    level = ADDRESS_LEVELS[Math.min(i, ADDRESS_LEVELS.length - 1)];
  }
  return current as AddressNode | AddressNode[];
}

/** Immediate children offered for the parent at `path` ([] = all villes). */
export function optionsUnder(registry: AddressRegistry, path: AddressPath): AddressNode[] {
  if (path.length === 0) return registry.villes;
  const parent = getNode(registry, path);
  if (!parent || Array.isArray(parent)) return [];
  const level = levelOfPath(path);
  if (level === 'avenue') return [];
  return childrenArray(parent, level);
}

export interface AddressCounts {
  villes: number;
  communes: number;
  quartiers: number;
  avenues: number;
}

export function countAddressTree(registry: AddressRegistry): AddressCounts {
  const counts: AddressCounts = { villes: registry.villes.length, communes: 0, quartiers: 0, avenues: 0 };
  registry.villes.forEach((ville) => {
    counts.communes += ville.communes.length;
    ville.communes.forEach((commune) => {
      counts.quartiers += commune.quartiers.length;
      commune.quartiers.forEach((quartier) => {
        counts.avenues += quartier.avenues.length;
      });
    });
  });
  return counts;
}

function countBelow(node: AddressNode, level: AddressLevel, counts: AddressCounts): void {
  if (level === 'ville') {
    const ville = node as AddressVille;
    counts.communes += ville.communes.length;
    ville.communes.forEach((commune) => countBelow(commune, 'commune', counts));
    return;
  }
  if (level === 'commune') {
    const commune = node as AddressCommune;
    counts.quartiers += commune.quartiers.length;
    commune.quartiers.forEach((quartier) => countBelow(quartier, 'quartier', counts));
    return;
  }
  if (level === 'quartier') {
    counts.avenues += (node as AddressQuartier).avenues.length;
  }
}

/** How many nodes disappear if `path` is removed, counted level by level. */
export function subtreeCounts(registry: AddressRegistry, path: AddressPath): AddressCounts {
  const node = getNode(registry, path);
  const counts: AddressCounts = { villes: 0, communes: 0, quartiers: 0, avenues: 0 };
  if (!node || Array.isArray(node)) return counts;
  const level = levelOfPath(path);
  counts[{ ville: 'villes', commune: 'communes', quartier: 'quartiers', avenue: 'avenues' }[level]] = 1;
  countBelow(node, level, counts);
  return counts;
}

/** "Goma › Commune de Goma › Les Cubi" — the breadcrumb a node sits under. */
export function describeAddressPath(registry: AddressRegistry, path: AddressPath): string {
  const names: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = getNode(registry, path.slice(0, i + 1));
    if (node && !Array.isArray(node)) names.push(node.name);
  }
  return names.join(' › ');
}

function toPlainRegistry(registry: AddressRegistry): AddressRegistry {
  // Firestore rejects `undefined` and functions; rebuild the tree from the
  // fields that are actually persisted.
  return {
    id: ADDRESS_REGISTRY_DOC,
    updatedAt: registry.updatedAt,
    updatedBy: registry.updatedBy,
    villes: registry.villes.map((ville) => ({
      id: ville.id,
      name: ville.name,
      communes: ville.communes.map((commune) => ({
        id: commune.id,
        name: commune.name,
        quartiers: commune.quartiers.map((quartier) => ({
          id: quartier.id,
          name: quartier.name,
          avenues: quartier.avenues.map((avenue) => ({ id: avenue.id, name: avenue.name })),
        })),
      })),
    })),
  };
}

/* ==================================================================== */
/*  SEEDING                                                             */
/*                                                                      */
/*  The registry ships empty by design — it is configuration an Admin    */
/*  owns, and an Admin's deliberate clean slate must never be            */
/*  overwritten. But a picker fed from an empty tree is a card nobody    */
/*  can fill in, so a *missing* document is seeded with the city's       */
/*  administrative structure. The quartier lists are the ones the        */
/*  registry itself already uses; avenues are the ones the cadastre      */
/*  recorded, attached to the quartier they were declared under.         */
/* ==================================================================== */

interface SeedQuartier {
  name: string;
  avenues: string[];
}

interface SeedCommune {
  name: string;
  quartiers: SeedQuartier[];
}

interface SeedVille {
  name: string;
  communes: SeedCommune[];
}

/** The opening tree: one ville, its two communes, and what sits under each. */
const SEED_TREE: SeedVille[] = [
  {
    name: 'Goma',
    communes: [
      {
        name: 'Goma',
        quartiers: [
          { name: 'Birere', avenues: ['Marché Central', 'Marché Nzaha'] },
          { name: 'Himbi', avenues: ['Avenue du Lac'] },
          { name: 'Katindo', avenues: ['Avenue Kinshasa'] },
          { name: 'Kyeshero', avenues: ['Avenue Rumangabo'] },
          { name: 'Les Volcans', avenues: ['Boulevard Kanyamuhanga', 'Marché Maman Safi'] },
          { name: 'Mabanga Sud', avenues: ['Route Goma-Sake'] },
          { name: 'Ndoriko', avenues: ['Avenue Luapula'] },
        ],
      },
      {
        name: 'Karisimbi',
        quartiers: [
          { name: 'Bujovu', avenues: ['Route Aéroport'] },
          { name: 'Kahembe', avenues: ['Avenue Itimbiri'] },
          { name: 'Kasika', avenues: ['Avenue Saio'] },
          { name: 'Kizimba', avenues: ['Avenue Bunia'] },
          { name: 'Mabanga Nord', avenues: ['Route Karisimbi'] },
          { name: 'Majengo', avenues: ['Avenue du Commerce'] },
          { name: 'Nyiragongo', avenues: ['Route Virunga'] },
        ],
      },
    ],
  },
];

/**
 * Stable, readable id for a node, unique among its siblings.
 *
 * IDs are always derived from the administrative name — never typed by a user.
 * The same helper seeds the opening tree and generates ids for every node added
 * at runtime, so both paths obey one shape and one collision rule.
 */
function generateAddressId(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 12)
      .toUpperCase() || 'NODE';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 17)}_${n++}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Pick the id for a newly added node.
 *
 * A live registry can carry two conventions: the seeded tree uses readable
 * codes derived from names (GOMA, KARISIMBI), while a branch an Admin has been
 * numbering by hand uses zero-padded sequence numbers (01, 02). A new node
 * follows whichever convention its siblings already use, so automating the
 * field never changes the shape of a live register. Empty and mixed groups
 * fall back to name-derived codes.
 */
function nextAddressId(siblings: AddressNode[], name: string): string {
  const taken = new Set(siblings.map((sibling) => sibling.id.toLowerCase()));
  const numericIds = siblings.filter((sibling) => /^\d+$/.test(sibling.id));
  const numericBranch = siblings.length > 0 && numericIds.length === siblings.length;

  if (numericBranch) {
    const width = Math.max(2, ...numericIds.map((sibling) => sibling.id.length));
    let next = Math.max(...numericIds.map((sibling) => Number(sibling.id))) + 1;
    let candidate = String(next).padStart(width, '0');
    while (taken.has(candidate.toLowerCase())) {
      next += 1;
      candidate = String(next).padStart(width, '0');
    }
    return candidate;
  }

  return generateAddressId(name, taken);
}

/** Expand the seed declaration into a full registry tree. */
export function buildSeedRegistry(): AddressRegistry {
  const villes: AddressVille[] = SEED_TREE.map((ville) => ({
    id: generateAddressId(ville.name, new Set()),
    name: ville.name,
    communes: ville.communes.map((commune) => ({
      id: generateAddressId(commune.name, new Set()),
      name: commune.name,
      quartiers: commune.quartiers.map((quartier) => ({
        id: generateAddressId(quartier.name, new Set()),
        name: quartier.name,
        avenues: quartier.avenues.map((avenue) => ({
          id: generateAddressId(avenue, new Set()),
          name: avenue,
        })),
      })),
    })),
  }));

  return {
    id: ADDRESS_REGISTRY_DOC,
    villes,
    updatedAt: new Date().toISOString(),
    updatedBy: 'System — seeded administrative hierarchy',
  };
}

/**
 * Seed the address tree when the document is missing.
 *
 * Idempotent and deliberately conservative: an existing document is left
 * completely alone even when empty, because an empty tree may be an Admin's
 * intentional clean slate. Non-fatal — a write failure leaves the caller with
 * whatever the snapshot listener delivers.
 */
export async function ensureAddressRegistrySeeded(): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'settings', ADDRESS_REGISTRY_DOC));
    if (snap.exists()) return;
    await setDoc(doc(db, 'settings', ADDRESS_REGISTRY_DOC), toPlainRegistry(buildSeedRegistry()));
  } catch (err) {
    console.warn('[Addresses] Could not seed the address tree:', err);
  }
}

/* ==================================================================== */
/*  PERSISTENCE                                                         */
/* ==================================================================== */

export function subscribeToAddressRegistry(
  callback: (registry: AddressRegistry) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'settings', ADDRESS_REGISTRY_DOC),
    (snap) => {
      if (!snap.exists()) {
        callback(emptyAddressRegistry());
        return;
      }
      const data = snap.data() as AddressRegistry;
      callback({ ...emptyAddressRegistry(), ...data, villes: data.villes || [] });
    },
    (err) => {
      console.warn('[Addresses] Hierarchy listener unavailable:', err);
      callback(emptyAddressRegistry());
    }
  );
}

interface Actor {
  uid: string;
  displayName: string;
  role: UserRole;
}

/**
 * Apply one mutation to the tree inside a transaction.
 *
 * The whole tree lives in a single document, so a read-modify-write that raced
 * another Admin's save would silently delete their branch. Re-reading inside the
 * transaction is the cheap fix.
 */
async function mutateRegistry(
  mutator: (registry: AddressRegistry) => { registry: AddressRegistry; details: string },
  actor: Actor,
  action: string
): Promise<AddressRegistry> {
  const ref = doc(db, 'settings', ADDRESS_REGISTRY_DOC);

  const saved = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current: AddressRegistry = snap.exists()
      ? { ...emptyAddressRegistry(), ...(snap.data() as AddressRegistry), villes: (snap.data() as AddressRegistry).villes || [] }
      : emptyAddressRegistry();

    const { registry, details } = mutator(current);
    const next: AddressRegistry = {
      ...registry,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.displayName,
    };
    const plain = toPlainRegistry(next);
    tx.set(ref, plain);
    return { plain, details };
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    action,
    'AddressNode',
    ADDRESS_REGISTRY_DOC,
    saved.details
  ).catch(() => {});

  return saved.plain;
}

/**
 * Add a node. `parentPath` is [] to create a ville.
 *
 * The id is generated inside the transaction from the submitted name, so a
 * caller cannot choose it and two concurrent additions can never collide.
 */
export async function addAddressNode(
  parentPath: AddressPath,
  input: { name: string },
  actor: Actor
): Promise<AddressRegistry> {
  const name = input.name.trim();
  const childLevel = childLevelOf(parentPath);
  if (!childLevel) throw new Error('Avenues are the deepest level — a node cannot be added below one.');
  if (!name) throw new Error(`${ADDRESS_LEVEL_META[childLevel].label} name is required.`);

  return mutateRegistry(
    (registry) => {
      const siblings = parentPath.length === 0
        ? registry.villes
        : (() => {
            const parent = getNode(registry, parentPath);
            if (!parent || Array.isArray(parent)) throw new Error('That parent address no longer exists.');
            return childrenArray(parent, levelOfPath(parentPath));
          })();

      const id = nextAddressId(siblings, name);

      const node: AddressNode = {
        id,
        name,
        ...(childLevel === 'ville' ? { communes: [] } : {}),
        ...(childLevel === 'commune' ? { quartiers: [] } : {}),
        ...(childLevel === 'quartier' ? { avenues: [] } : {}),
      } as AddressNode;

      const next = insertAt(registry, parentPath, node);
      const parentLabel = parentPath.length ? describeAddressPath(registry, parentPath) : null;
      return {
        registry: next,
        details: parentLabel
          ? `${ADDRESS_LEVEL_META[childLevel].label} "${name}" (${id}) added under ${parentLabel}.`
          : `${ADDRESS_LEVEL_META[childLevel].label} "${name}" (${id}) added to the address hierarchy.`,
      };
    },
    actor,
    'CREATE_ADDRESS_NODE'
  );
}

function insertAt(registry: AddressRegistry, parentPath: AddressPath, node: AddressNode): AddressRegistry {
  if (parentPath.length === 0) {
    return { ...registry, villes: [...registry.villes, node as AddressVille] };
  }
  const walk = (list: AddressNode[], depth: number): AddressNode[] =>
    list.map((item) => {
      if (item.id !== parentPath[depth]) return item;
      const level = ADDRESS_LEVELS[depth];
      if (depth === parentPath.length - 1) {
        return mapChildren(item, level, (children) => [...children, node]);
      }
      return mapChildren(item, level, (children) => walk(children, depth + 1));
    });

  return { ...registry, villes: walk(registry.villes, 0) as AddressVille[] };
}

/** Rename a node's label without touching its id or its children. */
export async function renameAddressNode(
  path: AddressPath,
  name: string,
  actor: Actor
): Promise<AddressRegistry> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');
  const level = levelOfPath(path);

  return mutateRegistry(
    (registry) => {
      const before = getNode(registry, path);
      if (!before || Array.isArray(before)) throw new Error('That address node no longer exists.');
      const next = replaceAt(registry, path, { ...before, name: trimmed });
      return {
        registry: next,
        details: `${ADDRESS_LEVEL_META[level].label} "${before.name}" (${path[path.length - 1]}) renamed to "${trimmed}".`,
      };
    },
    actor,
    'UPDATE_ADDRESS_NODE'
  );
}

/** Delete a node and everything nested under it. */
export async function removeAddressNode(
  path: AddressPath,
  actor: Actor
): Promise<AddressRegistry> {
  const level = levelOfPath(path);
  return mutateRegistry(
    (registry) => {
      const node = getNode(registry, path);
      if (!node || Array.isArray(node)) throw new Error('That address node no longer exists.');
      const sub = subtreeCounts(registry, path);
      const nested =
        sub.communes + sub.quartiers + sub.avenues > 0
          ? ` This also removes ${[
              sub.communes ? `${sub.communes} commune(s)` : '',
              sub.quartiers ? `${sub.quartiers} quartier(s)` : '',
              sub.avenues ? `${sub.avenues} avenue(s)` : '',
            ].filter(Boolean).join(', ')}.`
          : '';
      return {
        registry: removeAt(registry, path),
        details: `${ADDRESS_LEVEL_META[level].label} "${node.name}" (${node.id}) removed from the address hierarchy.${nested}`,
      };
    },
    actor,
    'DELETE_ADDRESS_NODE'
  );
}

function replaceAt(registry: AddressRegistry, path: AddressPath, node: AddressNode): AddressRegistry {
  const walk = (list: AddressNode[], depth: number): AddressNode[] =>
    list.map((item) => {
      if (item.id !== path[depth]) return item;
      if (depth === path.length - 1) return node;
      return mapChildren(item, ADDRESS_LEVELS[depth], (children) => walk(children, depth + 1));
    });
  return { ...registry, villes: walk(registry.villes, 0) as AddressVille[] };
}

function removeAt(registry: AddressRegistry, path: AddressPath): AddressRegistry {
  const walk = (list: AddressNode[], depth: number): AddressNode[] =>
    list
      .filter((item) => !(depth === path.length - 1 && item.id === path[depth]))
      .map((item) => {
        if (item.id !== path[depth]) return item;
        return mapChildren(item, ADDRESS_LEVELS[depth], (children) => walk(children, depth + 1));
      });
  return { ...registry, villes: walk(registry.villes, 0) as AddressVille[] };
}
