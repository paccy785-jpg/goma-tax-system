import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  query,
  limit,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import {
  BoardAnnouncement,
  BoardCategory,
  BoardDepartment,
  BoardReply,
  UserRole,
  normalizeBoardCategory,
  normalizeBoardDepartment,
} from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';

const COLLECTION = 'announcements';

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeReply(raw: any): BoardReply {
  return {
    id: String(raw?.id || `reply_${Date.now().toString(36)}`),
    authorId: String(raw?.authorId || ''),
    authorName: String(raw?.authorName || 'Officer'),
    authorRole: String(raw?.authorRole || ''),
    body: String(raw?.body || ''),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
  };
}

function normalizeAnnouncement(raw: any): BoardAnnouncement {
  return {
    id: String(raw?.id || `post_${Date.now().toString(36)}`),
    title: String(raw?.title || 'Untitled').trim() || 'Untitled',
    body: String(raw?.body || ''),
    category: normalizeBoardCategory(raw?.category),
    department: normalizeBoardDepartment(raw?.department),
    status: raw?.status === 'Resolved' ? 'Resolved' : 'Open',
    pinned: raw?.pinned === true,
    authorId: String(raw?.authorId || ''),
    authorName: String(raw?.authorName || 'Officer'),
    authorRole: String(raw?.authorRole || ''),
    replies: Array.isArray(raw?.replies) ? raw.replies.map(normalizeReply) : [],
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads — Firestore is the only store
// ---------------------------------------------------------------------------

export async function getBoardAnnouncements(): Promise<BoardAnnouncement[]> {
  try {
    const snapshot = await getDocs(collection(db, COLLECTION));
    return snapshot.docs.map((d) => normalizeAnnouncement({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, COLLECTION);
    return [];
  }
}

export function subscribeToBoardAnnouncements(
  onData: (posts: BoardAnnouncement[]) => void,
  onError?: (err: any) => void,
  limitCount = 300
): Unsubscribe {
  const q = query(collection(db, COLLECTION), limit(limitCount));
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => normalizeAnnouncement({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('[Firestore Listener] Error on announcements:', err);
      emitGlobalToast(
        `Error syncing announcement board: ${err?.message || 'Permission or network issue'}`,
        'error',
        'Sync Error'
      );
      if (onError) onError(err);
      onData([]);
    }
  );
  return () => unsubscribe();
}

// ---------------------------------------------------------------------------
// Writes — every post, reply and moderation stamps the audit ledger
// ---------------------------------------------------------------------------

export interface CreatePostInput {
  title: string;
  body: string;
  category: BoardCategory;
  department: BoardDepartment;
  actor: { uid: string; displayName: string; role: UserRole };
}

export async function createBoardPost(input: CreatePostInput): Promise<BoardAnnouncement> {
  const now = new Date().toISOString();
  const id = intentId('post', 'board.createPost', [
    input.title,
    input.body,
    input.category,
    input.department,
    input.actor.uid,
  ]);
  const post: BoardAnnouncement = {
    id,
    title: input.title.trim(),
    body: input.body.trim(),
    category: normalizeBoardCategory(input.category),
    department: normalizeBoardDepartment(input.department),
    status: 'Open',
    pinned: false,
    authorId: input.actor.uid,
    authorName: input.actor.displayName,
    authorRole: input.actor.role,
    replies: [],
    createdAt: now,
  };
  try {
    await setDoc(doc(db, COLLECTION, id), post);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${COLLECTION}/${id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'BOARD_POST_CREATED',
    'Announcement',
    id,
    `Board post "${post.title}" addressed to ${post.department} (${post.category}).`
  );
  return post;
}

export interface AddReplyInput {
  body: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

export async function addBoardReply(
  post: BoardAnnouncement,
  input: AddReplyInput
): Promise<BoardAnnouncement> {
  const now = new Date().toISOString();
  const reply: BoardReply = {
    id: `reply_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    authorId: input.actor.uid,
    authorName: input.actor.displayName,
    authorRole: input.actor.role,
    body: input.body.trim(),
    createdAt: now,
  };
  const updated: BoardAnnouncement = {
    ...post,
    replies: [...post.replies, reply],
    updatedAt: now,
  };
  // arrayUnion appends atomically server-side. The old code wrote the whole
  // `replies` array back with updateDoc: two officers replying in overlapping
  // windows both appended to the pre-existing array and the second write
  // silently dropped the first reply — lost official record.
  try {
    await updateDoc(doc(db, COLLECTION, post.id), {
      replies: arrayUnion(reply),
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${post.id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'BOARD_REPLY_ADDED',
    'Announcement',
    post.id,
    `Reply added by ${input.actor.displayName} on board post "${post.title}".`
  );
  return updated;
}

export async function setPostPinned(
  post: BoardAnnouncement,
  pinned: boolean,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTION, post.id), { pinned, updatedAt: new Date().toISOString() });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${post.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    pinned ? 'BOARD_POST_PINNED' : 'BOARD_POST_UNPINNED',
    'Announcement',
    post.id,
    `Board post "${post.title}" ${pinned ? 'pinned to the top of the board' : 'unpinned'} by ${actor.displayName}.`
  );
}

export async function setPostStatus(
  post: BoardAnnouncement,
  status: 'Open' | 'Resolved',
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTION, post.id), { status, updatedAt: new Date().toISOString() });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${post.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    status === 'Resolved' ? 'BOARD_ISSUE_RESOLVED' : 'BOARD_ISSUE_REOPENED',
    'Announcement',
    post.id,
    `Board ${post.category.toLowerCase()} "${post.title}" marked as ${status} by ${actor.displayName}.`
  );
}

export async function deleteBoardPost(
  post: BoardAnnouncement,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION, post.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${COLLECTION}/${post.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'BOARD_POST_DELETED',
    'Announcement',
    post.id,
    `Board post "${post.title}" (${post.category}, ${post.department}) removed by ${actor.displayName}. ${post.replies.length} replie(s) were attached.`
  );
}
