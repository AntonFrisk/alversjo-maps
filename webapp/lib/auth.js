import GithubProvider from 'next-auth/providers/github';

async function fetchEditors() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) return [];
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/editors.json`,
      { next: { revalidate: 120 } }
    );
    if (!res.ok) return [];
    const { editors } = await res.json();
    return Array.isArray(editors) ? editors : [];
  } catch {
    return [];
  }
}

export async function isEditor(githubLogin) {
  if (!githubLogin) return false;
  const editors = await fetchEditors();
  return editors.includes(githubLogin);
}

export const authOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.login) {
        token.githubLogin = profile.login;
        token.isEditor = await isEditor(profile.login);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.githubLogin = token.githubLogin;
      session.user.isEditor = token.isEditor ?? false;
      return session;
    },
  },
};
