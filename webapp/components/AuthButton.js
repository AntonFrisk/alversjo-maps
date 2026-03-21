'use client';
import { useSession, signIn, signOut } from 'next-auth/react';

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <div className="auth-widget auth-loading">…</div>;
  }

  if (!session) {
    return (
      <div className="auth-widget auth-signed-out">
        <button className="auth-signin-btn" onClick={() => signIn('github')}>
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="auth-widget auth-signed-in">
      <img
        src={session.user.image}
        alt={session.user.name}
        className="auth-avatar"
        referrerPolicy="no-referrer"
      />
      <span className="auth-name">{session.user.name}</span>
      {session.user.isEditor && <span className="auth-editor-badge">Editor</span>}
      <button className="auth-signout-btn" onClick={() => signOut()}>
        Sign out
      </button>
    </div>
  );
}
