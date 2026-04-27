import { gt, valid } from 'semver';

export const REPO = 'IgorKvasn/whats';
export const THROTTLE_SECONDS = 24 * 60 * 60;
export const FAILURE_THRESHOLD = 3;
export const BODY_EXCERPT_MAX_CHARS = 500;

export interface ReleaseInfo {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
  html_url: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releasedAt: string;
  bodyExcerpt: string;
  htmlUrl: string;
}

export type FetchOutcome =
  | { kind: 'found'; release: ReleaseInfo }
  | { kind: 'no-releases' }
  | { kind: 'failed'; error: string };

function stripV(s: string): string {
  return s.startsWith('v') ? s.slice(1) : s;
}

export function decideUpdate(
  current: string,
  latestTag: string,
  skippedVersion: string | null,
): boolean {
  if (skippedVersion && skippedVersion === latestTag) return false;

  const currentClean = valid(stripV(current));
  const latestClean = valid(stripV(latestTag));

  if (!currentClean || !latestClean) return false;
  return gt(latestClean, currentClean);
}

export function buildUpdateInfo(release: ReleaseInfo, currentVersion: string): UpdateInfo {
  const name = release.name?.trim();
  const releaseName = name && name.length > 0 ? name : release.tag_name;

  return {
    currentVersion,
    latestVersion: release.tag_name,
    releaseName,
    releasedAt: release.published_at ?? '',
    bodyExcerpt: bodyExcerpt(release.body, BODY_EXCERPT_MAX_CHARS),
    htmlUrl: release.html_url,
  };
}

export function bodyExcerpt(
  body: string | null | undefined,
  maxChars: number,
): string {
  const raw = (body ?? '').trim();
  if ([...raw].length <= maxChars) return raw;
  const truncated = [...raw].slice(0, maxChars).join('');
  return truncated + '…';
}

export function shouldRunCheck(nowUnix: number, lastCheckedAt: number | null): boolean {
  if (lastCheckedAt === null) return true;
  return nowUnix - lastCheckedAt >= THROTTLE_SECONDS;
}

export async function fetchLatestRelease(
  repo: string,
  appVersion: string,
): Promise<FetchOutcome> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const userAgent = `whats-desktop/${appVersion}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { kind: 'failed', error: `request: ${err}` };
  }

  if (response.status === 404) return { kind: 'no-releases' };
  if (!response.ok) return { kind: 'failed', error: `http ${response.status}` };

  try {
    const info = (await response.json()) as ReleaseInfo;
    return { kind: 'found', release: info };
  } catch (err) {
    return { kind: 'failed', error: `parse: ${err}` };
  }
}
