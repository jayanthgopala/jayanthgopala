/**
 * Minimal GitHub Contents API client — just enough to keep one file in sync.
 *
 * Token requirement: a fine-grained PAT scoped to the profile repo only, with
 * `Contents: read and write`. See docs/GITHUB-TOKEN.md.
 */

const API = 'https://api.github.com';

function headers(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects requests without a User-Agent.
    'User-Agent': 'portfolio-sync-worker',
  };
}

/** UTF-8 safe base64 — btoa() alone mangles non-ASCII (emoji in the README). */
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function contentsUrl(env) {
  const { GITHUB_USER, GITHUB_REPO, README_PATH } = env;
  return `${API}/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${README_PATH}`;
}

/** Current blob SHA of the README, or null if the file doesn't exist yet. */
async function getFileSha(env) {
  const url = `${contentsUrl(env)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: headers(env) });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  return json.sha;
}

async function putContents(env, { content, sha, message }) {
  const res = await fetch(contentsUrl(env), {
    method: 'PUT',
    headers: { ...headers(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  return res;
}

/**
 * Write the README. Re-reads the SHA and retries once on 409/422, which is what
 * GitHub returns when the file moved between our read and our write.
 */
export async function pushReadme(env, content, message) {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set — run: wrangler secret put GITHUB_TOKEN');
  }

  let sha = await getFileSha(env);
  let res = await putContents(env, { content, sha, message });

  if (res.status === 409 || res.status === 422) {
    sha = await getFileSha(env);
    res = await putContents(env, { content, sha, message });
  }

  if (!res.ok) {
    throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return {
    commitSha: json.commit?.sha || '',
    commitUrl: json.commit?.html_url || '',
  };
}

/** Public profile data — used to auto-fill the avatar and sanity-check the token. */
export async function fetchGitHubUser(env) {
  const res = await fetch(`${API}/users/${env.GITHUB_USER}`, { headers: headers(env) });
  if (!res.ok) return null;
  const u = await res.json();
  return {
    login: u.login,
    avatarUrl: u.avatar_url,
    followers: u.followers,
    publicRepos: u.public_repos,
    htmlUrl: u.html_url,
  };
}
