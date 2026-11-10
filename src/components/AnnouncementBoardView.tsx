import React, { useEffect, useMemo, useState } from 'react';
import {
  Megaphone,
  Plus,
  Search,
  Pin,
  PinOff,
  CheckCircle2,
  RotateCcw,
  Trash2,
  MessageSquare,
  Send,
  AlertTriangle,
  X,
  ChevronDown,
  Clock3,
} from 'lucide-react';
import {
  BoardAnnouncement,
  BoardCategory,
  BoardDepartment,
  UserRole,
  BOARD_CATEGORIES,
  BOARD_DEPARTMENTS,
  BOARD_DEPARTMENT_LABELS,
} from '../types';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { BoardScheduleView } from './BoardScheduleView';
import {
  addBoardReply,
  createBoardPost,
  deleteBoardPost,
  getBoardAnnouncements,
  setPostPinned,
  setPostStatus,
  subscribeToBoardAnnouncements,
} from '../services/announcementService';

interface AnnouncementBoardViewProps {
  userRole: UserRole;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '—';
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const initialsOf = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'DG';

const CATEGORY_TONE: Record<BoardCategory, string> = {
  Announcement: 'from-accent/80 to-accent-dark text-white',
  Issue: 'from-warn/85 to-accent/70 text-white',
  Memo: 'from-navy/80 to-navy2 text-white',
  Urgent: 'from-danger/80 to-accent/80 text-white',
};

export const AnnouncementBoardView: React.FC<AnnouncementBoardViewProps> = ({ userRole }) => {
  const { showToast } = useToast();
  const { userProfile } = useAuth();

  const [posts, setPosts] = useState<BoardAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardTab, setBoardTab] = useState<'posts' | 'schedule'>('posts');
  const [deptTab, setDeptTab] = useState<'all' | BoardDepartment>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | BoardCategory>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState('');

  const [composerOpen, setComposerOpen] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postCategory, setPostCategory] = useState<BoardCategory>('Announcement');
  const [postDept, setPostDept] = useState<BoardDepartment>('General');
  const [publishing, setPublishing] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingReply, setSendingReply] = useState<Record<string, boolean>>({});

  const canModerate = userRole === 'Admin' || userRole === 'Supervisor';
  const actor = {
    uid: userProfile?.uid || 'local_session',
    displayName: userProfile?.displayName || 'DPRNK Officer',
    role: userRole,
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getBoardAnnouncements()
      .then((list) => {
        if (mounted) setPosts(list);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const unsub = subscribeToBoardAnnouncements((list) => {
      if (!mounted) return;
      setPosts(list);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const metrics = useMemo(() => {
    const openIssues = posts.filter(
      (p) => (p.category === 'Issue' || p.category === 'Urgent') && p.status === 'Open'
    ).length;
    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = posts.filter((p) => new Date(p.createdAt).getTime() >= weekAgo).length;
    const totalReplies = posts.reduce((sum, p) => sum + p.replies.length, 0);
    return { openIssues, thisWeek, totalReplies, total: posts.length };
  }, [posts]);

  const visiblePosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return posts
      .filter((p) => {
        const matchesDept = deptTab === 'all' || p.department === deptTab;
        const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
        const matchesOpen = !openOnly || p.status === 'Open';
        const matchesQuery =
          !normalized ||
          `${p.title} ${p.body} ${p.authorName}`.toLowerCase().includes(normalized);
        return matchesDept && matchesCategory && matchesOpen && matchesQuery;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [posts, deptTab, categoryFilter, openOnly, query]);

  const deptCounts = useMemo(() => {
    const counts: Record<BoardDepartment, number> = { General: 0, HR: 0, Finance: 0 };
    for (const p of posts) counts[p.department] += 1;
    return counts;
  }, [posts]);

  const openComposer = () => {
    setPostTitle('');
    setPostBody('');
    setPostCategory('Announcement');
    setPostDept(deptTab === 'all' ? 'General' : deptTab);
    setComposerOpen(true);
  };

  const submitPost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!postTitle.trim()) {
      showToast('Give the post a clear headline.', 'warning', 'Title required');
      return;
    }
    if (!postBody.trim()) {
      showToast('Write the message officers need to read.', 'warning', 'Message required');
      return;
    }
    setPublishing(true);
    try {
      const post = await createBoardPost({
        title: postTitle.trim(),
        body: postBody.trim(),
        category: postCategory,
        department: postDept,
        actor,
      });
      setPosts((current) => [post, ...current]);
      setComposerOpen(false);
      showToast(`Posted to ${BOARD_DEPARTMENT_LABELS[post.department]}.`, 'success', 'Published');
    } catch (err: any) {
      showToast(err?.message || 'Could not publish the post.', 'error', 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const submitReply = async (post: BoardAnnouncement) => {
    const draft = (replyDrafts[post.id] || '').trim();
    if (!draft) {
      showToast('Write your reply first.', 'warning', 'Empty reply');
      return;
    }
    setSendingReply((current) => ({ ...current, [post.id]: true }));
    try {
      const updated = await addBoardReply(post, { body: draft, actor });
      setPosts((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      setReplyDrafts((current) => ({ ...current, [post.id]: '' }));
      showToast('Reply posted on the thread.', 'success', 'Replied');
    } catch (err: any) {
      showToast(err?.message || 'Could not post the reply.', 'error', 'Reply failed');
    } finally {
      setSendingReply((current) => ({ ...current, [post.id]: false }));
    }
  };

  const togglePin = async (post: BoardAnnouncement) => {
    if (!canModerate) {
      showToast('Only Admin and Supervisor roles can pin posts.', 'warning', 'Restricted action');
      return;
    }
    try {
      await setPostPinned(post, !post.pinned, actor);
      setPosts((current) =>
        current.map((p) => (p.id === post.id ? { ...p, pinned: !post.pinned } : p))
      );
    } catch (err: any) {
      showToast(err?.message || 'Could not update the pin.', 'error', 'Update failed');
    }
  };

  const toggleStatus = async (post: BoardAnnouncement) => {
    const next = post.status === 'Open' ? 'Resolved' : 'Open';
    const allowed = canModerate || post.authorId === actor.uid;
    if (!allowed) {
      showToast('Only moderators or the original author can resolve this.', 'warning', 'Restricted action');
      return;
    }
    try {
      await setPostStatus(post, next, actor);
      setPosts((current) => current.map((p) => (p.id === post.id ? { ...p, status: next } : p)));
      showToast(next === 'Resolved' ? 'Marked as resolved.' : 'Reopened for follow-up.', 'success', next);
    } catch (err: any) {
      showToast(err?.message || 'Could not update the status.', 'error', 'Update failed');
    }
  };

  const handleDelete = async (post: BoardAnnouncement) => {
    const allowed = canModerate || post.authorId === actor.uid;
    if (!allowed) {
      showToast('Only moderators or the original author can remove this post.', 'warning', 'Restricted action');
      return;
    }
    try {
      await deleteBoardPost(post, actor);
      setPosts((current) => current.filter((p) => p.id !== post.id));
      showToast('Post removed from the board.', 'info', 'Deleted');
    } catch (err: any) {
      showToast(err?.message || 'Could not delete the post.', 'error', 'Delete failed');
    }
  };

  const categoryBadge = (category: BoardCategory) => {
    if (category === 'Urgent') return <Badge variant="danger" dot>Urgent</Badge>;
    if (category === 'Issue') return <Badge variant="warn" dot>Issue</Badge>;
    if (category === 'Memo') return <Badge variant="neutral" dot>Memo</Badge>;
    return <Badge variant="accent" dot>Announcement</Badge>;
  };

  const deptBadge = (dept: BoardDepartment) => {
    if (dept === 'HR') return <Badge variant="sage" dot>HR</Badge>;
    if (dept === 'Finance') return <Badge variant="warn" dot>Finance</Badge>;
    return <Badge variant="neutral" dot>All staff</Badge>;
  };

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        eyebrow="INTERNAL COMMS • DEPARTMENTS"
        title="Announcement Board"
        description="Address posts to All staff, HR, or Finance. Raise issues, share memos, and reply on each thread so every department stays in the loop."
        actions={
          boardTab === 'posts' ? (
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={openComposer}>
              New post
            </Button>
          ) : undefined
        }
      />

      {/* Subtabs: posts vs meeting schedule */}
      <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit -mt-2">
        <button
          type="button"
          onClick={() => setBoardTab('posts')}
          className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${boardTab === 'posts' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
        >
          Posts & threads <span className="ml-1.5 text-[11px] opacity-60">{posts.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setBoardTab('schedule')}
          className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${boardTab === 'schedule' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
        >
          Meeting schedule
        </button>
      </div>

      {boardTab === 'schedule' ? (
        <BoardScheduleView userRole={userRole} />
      ) : (
      <>
      <MetricStrip
        columns={4}
        className="mt-0"
        items={[
          { label: 'Open issues', value: String(metrics.openIssues), trend: metrics.openIssues > 0 ? 'Needs attention' : 'Clear', trendType: metrics.openIssues > 0 ? 'danger' : 'sage', subline: 'Issues + urgents unresolved', icon: <AlertTriangle className="w-4 h-4" /> },
          { label: 'Posted this week', value: String(metrics.thisWeek), subline: 'Fresh threads', icon: <Megaphone className="w-4 h-4" /> },
          { label: 'Replies exchanged', value: String(metrics.totalReplies), subline: 'Across all threads', icon: <MessageSquare className="w-4 h-4" /> },
          { label: 'Total posts', value: String(metrics.total), subline: 'On the board', icon: <Clock3 className="w-4 h-4" /> },
        ]}
      />

      {/* Department tabs + filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit flex-wrap">
          <button
            type="button"
            onClick={() => setDeptTab('all')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${deptTab === 'all' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            All <span className="ml-1.5 text-[11px] opacity-60">{posts.length}</span>
          </button>
          {BOARD_DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              type="button"
              onClick={() => setDeptTab(dept)}
              className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${deptTab === dept ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
            >
              {BOARD_DEPARTMENT_LABELS[dept]} <span className="ml-1.5 text-[11px] opacity-60">{deptCounts[dept]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 pr-3 rounded-[10px] bg-surface2 border border-line text-xs text-ink placeholder:text-muted focus:border-accent outline-none w-44 lg:w-52"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as 'all' | BoardCategory)}
            className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
            aria-label="Filter by category"
          >
            <option value="all">All types</option>
            {BOARD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setOpenOnly(!openOnly)}
            className={`h-9 px-3 rounded-[10px] border text-xs font-bold transition-premium cursor-pointer ${openOnly ? 'bg-navy text-white border-navy' : 'bg-surface2 text-muted border-line hover:text-ink'}`}
          >
            Open only
          </button>
        </div>
      </div>

      {loading ? (
        <Panel><div className="py-14 text-center text-sm text-muted">Opening the board…</div></Panel>
      ) : (
        <div className="space-y-4">
          {visiblePosts.map((post) => {
            const expanded = expandedIds[post.id] === true;
            const isAuthor = post.authorId === actor.uid;
            const canResolve = canModerate || isAuthor;
            const canDelete = canModerate || isAuthor;
            return (
              <Panel key={post.id} padding="none" className={post.pinned ? 'border-accent/50' : ''}>
                <div className="p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-[12px] bg-gradient-to-br ${CATEGORY_TONE[post.category]} flex items-center justify-center font-display font-bold text-xs shadow-xs shrink-0`}>
                      {initialsOf(post.authorName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {post.pinned && <Badge variant="accent" dot>Pinned</Badge>}
                        {categoryBadge(post.category)}
                        {deptBadge(post.department)}
                        {(post.category === 'Issue' || post.category === 'Urgent') && (
                          post.status === 'Resolved'
                            ? <Badge variant="sage" dot>Resolved</Badge>
                            : <Badge variant="danger" dot>Open</Badge>
                        )}
                      </div>
                      <h3 className="mt-2 font-display text-base sm:text-lg font-bold text-ink tracking-tight leading-snug">
                        {post.title}
                      </h3>
                      <p className="mt-1.5 text-sm text-muted leading-relaxed whitespace-pre-wrap">
                        {post.body}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span className="font-bold text-ink">{post.authorName}</span>
                        <span>{post.authorRole}</span>
                        <span>·</span>
                        <span>{timeAgo(post.createdAt)}</span>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setExpandedIds((current) => ({ ...current, [post.id]: !expanded }))}
                          className="inline-flex items-center gap-1 font-bold text-accent hover:text-accent-dark cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}
                          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {canModerate && (
                        <button
                          type="button"
                          title={post.pinned ? 'Unpin post' : 'Pin post'}
                          onClick={() => togglePin(post)}
                          className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-ink hover:border-accent cursor-pointer"
                          aria-label={post.pinned ? `Unpin ${post.title}` : `Pin ${post.title}`}
                        >
                          {post.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {(post.category === 'Issue' || post.category === 'Urgent') && canResolve && (
                        <button
                          type="button"
                          title={post.status === 'Open' ? 'Mark resolved' : 'Reopen'}
                          onClick={() => toggleStatus(post)}
                          className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-sage hover:border-sage cursor-pointer"
                          aria-label={`${post.status === 'Open' ? 'Resolve' : 'Reopen'} ${post.title}`}
                        >
                          {post.status === 'Open' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          title="Delete post"
                          onClick={() => handleDelete(post)}
                          className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-danger hover:border-danger/40 cursor-pointer"
                          aria-label={`Delete ${post.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-5 pt-4 border-t border-line space-y-3">
                      {post.replies.map((reply) => (
                        <div key={reply.id} className="flex gap-3">
                          <div className="w-7 h-7 rounded-[9px] bg-surface2 border border-line flex items-center justify-center font-display font-bold text-[11px] text-muted shrink-0">
                            {initialsOf(reply.authorName)}
                          </div>
                          <div className="min-w-0 flex-1 rounded-[12px] bg-surface2/60 border border-line px-3.5 py-2.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-xs font-bold text-ink">{reply.authorName}</span>
                              <span className="text-[11px] text-muted">{reply.authorRole}</span>
                              <span className="text-[11px] text-faint">· {timeAgo(reply.createdAt)}</span>
                            </div>
                            <p className="mt-1 text-[14px] text-ink/90 leading-relaxed whitespace-pre-wrap">{reply.body}</p>
                          </div>
                        </div>
                      ))}
                      {post.replies.length === 0 && (
                        <p className="text-xs text-muted">No replies yet — start the conversation.</p>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={replyDrafts[post.id] || ''}
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              submitReply(post);
                            }
                          }}
                          placeholder={`Reply as ${actor.displayName}…`}
                          className="flex-1 h-10 px-3.5 rounded-[10px] bg-surface2 border border-line text-xs text-ink placeholder:text-muted focus:border-accent outline-none"
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Send className="w-3.5 h-3.5" />}
                          onClick={() => submitReply(post)}
                          disabled={sendingReply[post.id]}
                        >
                          {sendingReply[post.id] ? 'Sending…' : 'Reply'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
          {visiblePosts.length === 0 && (
            <Panel>
              <div className="py-14 text-center">
                <Megaphone className="w-6 h-6 mx-auto mb-2 text-faint" />
                <p className="text-sm text-muted">Nothing on this lane yet. Post the first message.</p>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Composer */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between sticky top-0 bg-surface">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><Megaphone className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">New board post</h3>
                  <p className="text-xs text-muted mt-0.5">Pick the department that needs to see it.</p>
                </div>
              </div>
              <button type="button" onClick={() => setComposerOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitPost} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Headline</span>
                <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="e.g. Counter 2 printer jamming — Finance please advise" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-bold text-ink mb-1.5">Addressed to</span>
                  <div className="grid grid-cols-3 gap-2">
                    {BOARD_DEPARTMENTS.map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setPostDept(dept)}
                        className={`h-10 rounded-[10px] border text-xs font-bold transition-premium cursor-pointer ${postDept === dept ? 'bg-navy text-white border-navy' : 'bg-surface2 text-muted border-line hover:text-ink'}`}
                      >
                        {dept === 'General' ? 'All staff' : dept}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Type</span>
                  <select value={postCategory} onChange={(e) => setPostCategory(e.target.value as BoardCategory)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {BOARD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Message</span>
                <textarea value={postBody} onChange={(e) => setPostBody(e.target.value)} rows={5} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="What does the department need to know or do?" />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setComposerOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<Megaphone className="w-4 h-4" />} disabled={publishing}>
                  {publishing ? 'Publishing…' : 'Publish post'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
