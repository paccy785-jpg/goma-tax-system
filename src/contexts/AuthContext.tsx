import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as fbSignOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db, ACTIVE_PORTAL, otherPortalDb } from '../firebase/config';
import { UserProfile, UserRole, normalizeUserStatus } from '../types';
import { portalBrand } from '../branding';
import { getUserProfile, setUserProfile, logAuditEvent } from '../services/dbService';

/**
 * Whether the signed-in account may use THIS portal.
 *
 * The DPRNK and DGI portals have separate user accounts: a profile in one
 * portal's database gives no access to the other.
 * - granted:   the account has a profile here.
 * - checking:  the account has no profile here yet; deciding what to do.
 * - none:      the account has no profile here and gets none automatically
 *              (it may ask for access).
 */
export type PortalAccess = 'granted' | 'checking' | 'none';

/** The default office of a new profile on this portal. */
const PORTAL_DEFAULT_OFFICE = portalBrand(ACTIVE_PORTAL).defaultOffice;

/**
 * What the other portal's database says about an account.
 *
 * 'other'     — the account has a profile there.
 * 'not-other' — it does not.
 * 'unknown'   — the other database could not be reached, so nothing is known.
 */
type OtherPortalProbe = 'other' | 'not-other' | 'unknown';

/**
 * Ask the other portal's database whether an account belongs to it.
 *
 * A failure is reported as 'unknown' and never as 'not-other': the probe used
 * to return false on a timeout, and the DPRNK branch read that as "this is a
 * brand-new account" and issued it a DPRNK Cashier profile — handing a DGI
 * officer the entire DPRNK revenue register and ledger because a cross-database
 * read was slow. The rules now refuse such a profile on their own
 * (isDgiAccount in firestore.rules); this probe decides only what the officer
 * is told.
 */
async function probeOtherPortalAccount(uid: string): Promise<OtherPortalProbe> {
  try {
    const snap = await Promise.race([
      getDoc(doc(otherPortalDb(), 'users', uid)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    // A timeout tells us nothing: the account may well have a profile there.
    if (!snap) return 'unknown';
    return snap.exists() ? 'other' : 'not-other';
  } catch (err) {
    // The other database does not exist at all (nobody can be an account of a
    // portal that was never created) — that is a definite "not other". Any
    // other failure is a question we cannot answer.
    const code = (err as { code?: string })?.code;
    if (code === 'not-found') return 'not-other';
    return 'unknown';
  }
}

/**
 * The DGI portal's first administrator.
 *
 * DGI accounts are created by a DGI administrator — signing in gives no DGI
 * profile. So that there is a first administrator to create the others, the
 * first account to sign in to the DGI portal while it has none becomes its
 * Administrator. portalMeta/bootstrap records that this happened, and the
 * rules allow it exactly once. Runs as a transaction (server-confirmed), so a
 * refused attempt never shows an administrator profile even for an instant.
 */
async function claimFirstPortalAdmin(user: User): Promise<boolean> {
  const metaRef = doc(db, 'portalMeta', 'bootstrap');
  const userRef = doc(db, 'users', user.uid);
  return runTransaction(db, async (tx) => {
    const meta = await tx.get(metaRef);
    if (meta.exists()) return false;
    const now = new Date().toISOString();
    const profile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Administrateur'),
      role: 'Admin',
      status: 'Active',
      active: true,
      assignedOffice: PORTAL_DEFAULT_OFFICE,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(userRef, profile);
    tx.set(metaRef, { firstAdminUid: user.uid, firstAdminEmail: user.email || '', createdAt: now });
    return true;
  });
}

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  userRole: UserRole;
  /**
   * The role as stored on the server, before any "switch role for review"
   * override is applied. The override exists so an administrator can inspect the
   * other roles' screens; it must never be a way for a cashier to reach the
   * administrator's. Everything that gates a privileged action reads this, not
   * `userRole`.
   */
  baseRole: UserRole;
  /**
   * True until the first auth-state resolution (session restored or confirmed
   * absent). Gates the full-screen bootstrap loader — NOT `loading`, which also
   * flips during a sign-in attempt and would unmount the login form mid-attempt,
   * discarding the failure message.
   */
  initializing: boolean;
  loading: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role: UserRole, office?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  switchRoleQuick: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  isOfflineMode: boolean;
  setOfflineSimulated: (simulateOffline: boolean) => Promise<void>;
  /** Whether the signed-in account may use this portal (see PortalAccess). */
  portalAccess: PortalAccess;
  /** File an access request on this portal for the signed-in account. */
  requestPortalAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfileState] = useState<UserProfile | null>(null);
  // The server-side role, kept apart from the review override (see `baseRole`).
  const [baseRole, setBaseRole] = useState<UserRole>('Cashier');
  const [loading, setLoading] = useState<boolean>(true);
  const [initializing, setInitializing] = useState<boolean>(true);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(!navigator.onLine);
  const [portalAccess, setPortalAccess] = useState<PortalAccess>('granted');
  // Role assumed via the "switch role for review" feature. Client-side only —
  // it must never be persisted to the users/{uid} document, otherwise any
  // signed-in user could self-promote to Admin.
  const roleOverrideRef = React.useRef<UserRole | null>(null);
  // The account for which the DGI first-administrator claim was already tried
  // from a pending access request (tried once per account and page load).
  const claimTriedRef = React.useRef<string | null>(null);
  const overrideUidRef = React.useRef<string | null>(null);

  // Monitor network connectivity
  useEffect(() => {
    const handleOnline = () => setIsOfflineMode(false);
    const handleOffline = () => setIsOfflineMode(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    let unsubscribeDoc: (() => void) | null = null;
    let generation = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      const currentGeneration = ++generation;
      const isCurrent = () => currentGeneration === generation;
      // Clean up any previous profile listener before (re)subscribing —
      // the return inside this callback does NOT act as an effect cleanup.
      if (unsubscribeDoc) {
        try { unsubscribeDoc(); } catch {}
        unsubscribeDoc = null;
      }
      setCurrentUser(user);
      setUserProfileState(null);
      setBaseRole('Cashier');
      setPortalAccess(user ? 'checking' : 'granted');
      // A role review override belongs to exactly one signed-in user; drop it
      // whenever the auth identity changes.
      if (!user || user.uid !== overrideUidRef.current) {
        roleOverrideRef.current = null;
        overrideUidRef.current = null;
      }
      if (user) {
        // Fetch or subscribe to user doc from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        // Metadata changes are included so that a "no profile" read from the
        // local cache is followed by the server's answer even when it says the
        // same thing (otherwise that second snapshot is not delivered).
        const unsubscribeCurrentDoc = onSnapshot(userDocRef, { includeMetadataChanges: true }, (snap) => {
          if (!isCurrent()) return;
          const fromCache = snap.metadata.fromCache;
          if (snap.exists()) {
            setPortalAccess('granted');
            const data = snap.data() as UserProfile;
            // DGI: an access request filed while the portal had no administrator
            // yet (e.g. before its database existed) — that account becomes the
            // first administrator. If the portal already has one, nothing
            // happens and the request stays pending. On success this listener
            // fires again with the Administrator profile.
            if (
              ACTIVE_PORTAL === 'dgi' &&
              !fromCache &&
              data.accessRequested &&
              normalizeUserStatus(data) === 'Suspended' &&
              claimTriedRef.current !== user.uid
            ) {
              claimTriedRef.current = user.uid;
              claimFirstPortalAdmin(user).catch((claimErr) => {
                console.warn('[Auth] DGI first-administrator claim not applied:', claimErr);
              });
            }
            // Record the stored role BEFORE the review override is applied.
            setBaseRole(data.role);
            if (data.role !== 'Admin') roleOverrideRef.current = null;
            // Keep an in-session role review override sticky across doc updates.
            if (roleOverrideRef.current && data.role !== roleOverrideRef.current) {
              data.role = roleOverrideRef.current;
            }
            setUserProfileState(data);
            try {
              localStorage.setItem('goma_patente_active_session', JSON.stringify(data));
            } catch {}
          } else if (fromCache) {
            // "No profile" from the local cache only — wait for the server's
            // answer before deciding anything about access.
            setPortalAccess('checking');
            setUserProfileState(null);
          } else {
            // No profile in this portal's database.
            setPortalAccess('checking');
            setUserProfileState(null);
            const refuse = () => {
              if (!isCurrent()) return;
              setPortalAccess('none');
              setUserProfileState(null);
              try {
                localStorage.removeItem('goma_patente_active_session');
              } catch {}
            };
            if (ACTIVE_PORTAL === 'dgi') {
              // DGI: no profile is ever created just by signing in — only the
              // portal's very first administrator (see claimFirstPortalAdmin).
              // When that succeeds this listener fires again with the profile.
              claimFirstPortalAdmin(user)
                .then((became) => {
                  if (!became) refuse();
                })
                .catch((claimErr) => {
                  console.warn('[Auth] No DGI profile for this account:', claimErr);
                  refuse();
                });
            } else {
              // DPRNK: an account that belongs to the DGI portal is not given a
              // DPRNK profile automatically — the two portals' accounts are separate.
              probeOtherPortalAccount(user.uid).then((probe) => {
                if (!isCurrent()) return;
                if (probe === 'unknown') {
                  // The other portal could not be reached, so we cannot tell
                  // whether this account belongs to it. Guessing "no" would
                  // issue a DPRNK profile to a DGI officer — and with it the
                  // whole DPRNK revenue register. Refuse instead: the officer
                  // signs in again. (The rules refuse the profile write
                  // themselves — isDgiAccount in firestore.rules — so this is
                  // about what the officer is told, not about the control.)
                  console.warn(
                    '[Auth] The other portal could not be reached — access refused rather than granted.'
                  );
                  refuse();
                  return;
                }
                if (probe === 'other') {
                  refuse();
                  return;
                }
                // Profile doesn't exist yet; create fallback profile with least-privilege Cashier role
                const fallbackProfile: UserProfile = {
                  uid: user.uid,
                  email: user.email || 'officer@tax.gouv.cd',
                  displayName: user.displayName || 'Tax Officer',
                  role: 'Cashier' as UserRole,
                  status: 'Active',
                  assignedOffice: PORTAL_DEFAULT_OFFICE,
                  active: true,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                setUserProfile(fallbackProfile).then(() => {
                  if (!isCurrent()) return;
                  setPortalAccess('granted');
                  setBaseRole(fallbackProfile.role);
                  setUserProfileState(fallbackProfile);
                  try {
                    localStorage.setItem('goma_patente_active_session', JSON.stringify(fallbackProfile));
                  } catch {}
                }).catch((writeErr) => {
                  console.warn('[Auth] Fallback profile write failed:', writeErr);
                  refuse();
                });
              });
            }
          }
          setInitializing(false);
          setLoading(false);
        }, (err) => {
          if (!isCurrent()) return;
          console.warn('[Auth] User document snapshot error:', err);
          // Try local storage cache or fallback; always resolve loading so the
          // portal cannot hang on the spinner forever.
          getUserProfile(user.uid).then((p) => {
            if (!isCurrent()) return;
            if (p) {
              setBaseRole(p.role);
              if (p.role !== 'Admin') roleOverrideRef.current = null;
              if (roleOverrideRef.current && p.role !== roleOverrideRef.current) {
                p.role = roleOverrideRef.current;
              }
              setPortalAccess('granted');
              setUserProfileState(p);
              try {
                localStorage.setItem('goma_patente_active_session', JSON.stringify(p));
              } catch {}
            } else {
              setPortalAccess('none');
              setUserProfileState(null);
            }
          }).catch((profileErr) => {
            if (!isCurrent()) return;
            console.warn('[Auth] Profile recovery failed:', profileErr);
            setPortalAccess('none');
            setUserProfileState(null);
          }).finally(() => {
            if (!isCurrent()) return;
            setInitializing(false);
            setLoading(false);
          });
        });
        unsubscribeDoc = unsubscribeCurrentDoc;
      } else {
        // Firestore rules require request.auth, so a cached profile without a
        // live Firebase session would only produce permission-denied errors.
        try {
          localStorage.removeItem('goma_patente_active_session');
        } catch {}
        setUserProfileState(null);
        setBaseRole('Cashier');
        setPortalAccess('granted');
        setInitializing(false);
        setLoading(false);
      }
    });

    return () => {
      generation++;
      if (unsubscribeDoc) {
        try { unsubscribeDoc(); } catch {}
      }
      unsubscribeAuth();
    };
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      const profile = await getUserProfile(cred.user.uid).catch(() => null);
      if (!profile) {
        // No profile on this portal. The session listener decides — a DPRNK
        // Cashier profile, the DGI portal's first administrator, or no access
        // (the two portals' accounts are separate) — exactly as it does for a
        // restored session.
        return;
      }
      setPortalAccess('granted');
      setUserProfileState(profile);
      setBaseRole(profile.role);
      try {
        localStorage.setItem('goma_patente_active_session', JSON.stringify(profile));
      } catch {}
      // A suspended account (or a pending access request) may not write the
      // audit log; trying only raised an "Audit Gap" warning.
      if (normalizeUserStatus(profile) === 'Suspended') return;
      await logAuditEvent(
        profile.uid,
        profile.displayName,
        profile.role,
        'USER_LOGIN',
        'Auth',
        profile.uid,
        `Successful credentials login from Goma workstation.`
      ).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (
    email: string, 
    pass: string, 
    name: string, 
    _role: UserRole, 
    office: string = PORTAL_DEFAULT_OFFICE
  ) => {
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      
      // The role argument is deliberately ignored. A self-service sign-up may
      // only ever create a Cashier: accepting the caller's role here let anyone
      // register themselves as an Administrator, and the Firestore rules (which
      // refuse a self-created profile with role 'Admin') would then reject the
      // write, leaving the account stranded. Promotion is a maker-checker
      // decision taken by an existing administrator.
      const newProfile: UserProfile = {
        uid: cred.user.uid,
        email,
        displayName: name,
        role: 'Cashier' as UserRole,
        assignedOffice: office,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await setUserProfile(newProfile);
      setUserProfileState(newProfile);
      setBaseRole(newProfile.role);
      try {
        localStorage.setItem('goma_patente_active_session', JSON.stringify(newProfile));
      } catch {}
      await logAuditEvent(
        newProfile.uid,
        newProfile.displayName,
        newProfile.role,
        'USER_REGISTRATION',
        'User',
        newProfile.uid,
        `New tax officer registered as Cashier at ${office}.`
      ).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const user = cred.user;
      const profile = await getUserProfile(user.uid).catch(() => null);
      // No profile on this portal: the session listener decides (see email sign-in).
      if (!profile) return;
      setPortalAccess('granted');
      setUserProfileState(profile);
      setBaseRole(profile.role);
      try {
        localStorage.setItem('goma_patente_active_session', JSON.stringify(profile));
      } catch {}
      await logAuditEvent(
        profile.uid,
        profile.displayName,
        profile.role,
        'USER_LOGIN_GOOGLE',
        'User',
        profile.uid,
        `Google identity verified for officer station.`
      ).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  // Instant demo switcher for reviewers: switches the role locally only.
  // Deliberately does NOT write the role to the users/{uid} document — a
  // persisted write here would let any signed-in user self-promote to Admin.
  //
  // It is also restricted to a real Administrator. The override only changes
  // which screens are shown, but the screens are what expose privileged actions
  // (void a receipt, revoke a certificate, review an approval), so leaving it
  // open to every account let a Cashier pick "Admin" from the top bar and work
  // as one.
  const switchRoleQuick = async (newRole: UserRole) => {
    if (!userProfile || !currentUser) return;
    if (baseRole !== 'Admin') {
      throw new Error(
        'Only an Administrator may switch the active role. Your account keeps its assigned role.'
      );
    }
    roleOverrideRef.current = newRole;
    overrideUidRef.current = currentUser.uid;
    const updated: UserProfile = {
      ...userProfile,
      role: newRole,
      updatedAt: new Date().toISOString(),
    };
    setUserProfileState(updated);
    try {
      localStorage.setItem('goma_patente_active_session', JSON.stringify(updated));
    } catch {}
    try {
      await logAuditEvent(
        updated.uid,
        updated.displayName,
        newRole,
        'ROLE_CHANGE_SIMULATED',
        'User',
        updated.uid,
        `Role switched to ${newRole} for demonstration and testing (client-side only, not persisted).`
      );
    } catch (auditErr) {
      console.warn('[Auth] Role switch audit log failed:', auditErr);
    }
  };

  const logout = async () => {
    try {
      if (userProfile) {
        await logAuditEvent(
          userProfile.uid,
          userProfile.displayName,
          userProfile.role,
          'USER_LOGOUT',
          'Auth',
          userProfile.uid,
          `Officer logged out of station.`
        );
      }
      await fbSignOut(auth);
      roleOverrideRef.current = null;
      try {
        localStorage.removeItem('goma_patente_active_session');
      } catch {}
      setUserProfileState(null);
      setBaseRole('Cashier');
      setCurrentUser(null);
    } catch (err) {
      console.warn('[Logout]', err);
      roleOverrideRef.current = null;
      try {
        localStorage.removeItem('goma_patente_active_session');
      } catch {}
      setUserProfileState(null);
      setBaseRole('Cashier');
      setCurrentUser(null);
    }
  };

  /**
   * The signed-in account asks for access to this portal: a profile is filed
   * suspended, marked as an access request. An administrator of this portal
   * activates it from Users (or leaves it suspended).
   */
  const requestPortalAccess = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const now = new Date().toISOString();
    const request: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Officer'),
      role: 'Cashier',
      status: 'Suspended',
      active: false,
      accessRequested: true,
      accessRequestedAt: now,
      assignedOffice: PORTAL_DEFAULT_OFFICE,
      createdAt: now,
      updatedAt: now,
    };
    // An account that already has a profile here is not asking for access —
    // it is already an officer of this portal. Filing the request anyway
    // REPLACED the whole document (setDoc without merge), which silently
    // stripped the role of an administrator and suspended the account: with
    // the only Admin gone, nobody could undo it from the app.
    const existing = await getDoc(doc(db, 'users', user.uid));
    if (existing.exists()) {
      const data = existing.data() as UserProfile;
      throw new Error(
        'Ce compte a déjà un profil sur ce portail — un administrateur doit le réactiver.'
      );
    }
    await setDoc(doc(db, 'users', user.uid), request);
  };

  const setOfflineSimulated = async (simulate: boolean) => {
    setIsOfflineMode(simulate);
    try {
      const { disableNetwork, enableNetwork } = await import('firebase/firestore');
      if (simulate) {
        await disableNetwork(db);
        console.log('[Firestore] Offline mode simulated via disableNetwork');
      } else {
        await enableNetwork(db);
        console.log('[Firestore] Online network re-enabled via enableNetwork');
      }
    } catch (e) {
      console.warn('[Offline Mode Toggle]', e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        userRole: userProfile?.role || 'Cashier',
        baseRole,
        initializing,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        switchRoleQuick,
        logout,
        isOfflineMode,
        setOfflineSimulated,
        portalAccess,
        requestPortalAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
