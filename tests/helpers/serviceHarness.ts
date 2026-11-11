import { build } from 'esbuild';
import vm from 'node:vm';
import path from 'node:path';

/** Isolated Firestore double: executes real service code, enforces read-before-write,
 * and commits atomically. Never initializes Firebase or contacts a server. */
export async function serviceHarness(entry: string) {
  const records = new Map<string, any>();
  const denied = new Set<string>();
  const listeners = new Map<string, { next: (snapshot: any) => void; error: (error: any) => void }>();
  const snap = (ref: string) => ({ id: ref.split('/').at(-1), exists: () => records.has(ref), data: () => structuredClone(records.get(ref)) });
  const check = (ref: string) => {
    if ([...denied].some((p) => ref.startsWith(p))) throw Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
  };
  const fs = {
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    collection: (_db: unknown, name: string) => name,
    query: (ref: string, ..._rest: unknown[]) => ref,
    orderBy: () => null, limit: () => null, where: () => null, documentId: () => '__name__',
    getDoc: async (ref: string) => { check(ref); return snap(ref); },
    getDocs: async (ref: string) => ({ docs: [...records.keys()].filter((key) => key.startsWith(ref + '/')).map(snap) }),
    setDoc: async (ref: string, data: any) => { check(ref); records.set(ref, structuredClone(data)); },
    updateDoc: async (ref: string, data: any) => { check(ref); records.set(ref, { ...records.get(ref), ...structuredClone(data) }); },
    deleteDoc: async (ref: string) => { records.delete(ref); },
    onSnapshot: (ref: string, _options: unknown, next: (snapshot: any) => void, error: (e: any) => void) => { listeners.set(ref, { next, error }); return () => { listeners.delete(ref); }; },
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    runTransaction: async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
      const writes: [string, any, boolean][] = [];
      const result = await callback({
        get: async (ref: string) => {
          if (writes.length) throw new Error('Firestore transactions require all reads before writes');
          check(ref); return snap(ref);
        },
        set: (ref: string, data: any, options?: { merge: boolean }) => { check(ref); writes.push([ref, structuredClone(data), !!options?.merge]); },
        update: (ref: string, data: any) => { check(ref); writes.push([ref, structuredClone(data), true]); },
      });
      for (const [ref, data, merge] of writes) records.set(ref, merge ? { ...records.get(ref), ...data } : data);
      return result;
    },
  };
  const result = await build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    plugins: [{ name: 'isolate-database', setup(b) {
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'test' }));
      b.onResolve({ filter: /firebase\/config$/ }, () => ({ path: 'config', namespace: 'test' }));
      b.onResolve({ filter: /contexts\/ToastContext$/ }, () => ({ path: 'toast', namespace: 'test' }));
      b.onResolve({ filter: /certificateService$/ }, () => ({ path: 'certificate', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents:
        name === 'firestore' ? Object.keys(fs).map((key) => `export const ${key} = harnessFirestore.${key};`).join('\n') :
        name === 'config' ? 'export const db = {}; export const OperationType = {}; export function handleFirestoreError(e) { throw e; }' :
        name === 'toast' ? 'export function emitGlobalToast() {}' : 'export async function issueCertificateForAssessment() {}'
      }));
    } }],
  });
  const exports: any = {};
  const module = { exports };
  vm.runInNewContext(result.outputFiles[0].text, {
    exports, module, harnessFirestore: fs, console, Date, Map, Set, Number, Math, URL,
    TextEncoder, setTimeout, clearTimeout, structuredClone,
  }, { filename: path.basename(entry) });
  return { api: module.exports, records, denied, listeners, emit(ref: string, rows: any[] = [], fromCache = false) {
    listeners.get(ref)!.next({ docs: rows.map((row, i) => ({ id: String(row.id ?? i), data: () => row })), metadata: { fromCache, hasPendingWrites: false } });
  } };
}
