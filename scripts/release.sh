#!/usr/bin/env bash
#
# Release `whats`: bump version, build .deb, update CHANGELOG.md,
# tag, push, and publish a GitHub release with the .deb attached.
#
# Usage:
#   scripts/release.sh --bump <patch|minor|major|X.Y.Z> [flags]
#
# Flags:
#   --bump <level>    Required. patch | minor | major | explicit X.Y.Z
#   --draft           Create the GitHub release as a draft.
#   --prerelease      Mark the GitHub release as a prerelease.
#   --skip-tests      Pass --skip-tests to scripts/build-deb.sh.
#   --skip-apt        Pass --skip-apt to scripts/build-deb.sh (default on).
#   --no-skip-apt     Let build-deb.sh run apt-get install.
#   --remote <name>   Git remote to push to (default: origin).
#   --branch <name>   Expected current branch (default: main).
#   --yes             Don't prompt before destructive actions.
#   --dry-run         Print every mutating command, don't run them.
#   -h, --help        Show this help.
#
# Requirements: git, gh (authenticated), node, npm, dpkg-deb.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUMP=""
DRAFT=0
PRERELEASE=0
SKIP_TESTS=0
SKIP_APT=1
REMOTE="origin"
BRANCH="main"
ASSUME_YES=0
DRY_RUN=0

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)        BUMP="${2:-}"; shift 2 ;;
    --draft)       DRAFT=1; shift ;;
    --prerelease)  PRERELEASE=1; shift ;;
    --skip-tests)  SKIP_TESTS=1; shift ;;
    --skip-apt)    SKIP_APT=1; shift ;;
    --no-skip-apt) SKIP_APT=0; shift ;;
    --remote)      REMOTE="${2:-}"; shift 2 ;;
    --branch)      BRANCH="${2:-}"; shift 2 ;;
    --yes|-y)      ASSUME_YES=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '   [dry-run] %s\n' "$*"
  else
    eval "$@"
  fi
}

confirm() {
  [[ "${ASSUME_YES}" -eq 1 || "${DRY_RUN}" -eq 1 ]] && return 0
  read -r -p "$1 [y/N] " ans
  [[ "${ans}" =~ ^[Yy]$ ]]
}

cd "${REPO_ROOT}"

# ------------------------------------------------------------------
# Preconditions
# ------------------------------------------------------------------
log "Checking preconditions"

[[ -n "${BUMP}" ]] || die "--bump is required (patch|minor|major|X.Y.Z)"

for cmd in git gh node npm dpkg-deb; do
  command -v "${cmd}" >/dev/null 2>&1 || die "missing required tool: ${cmd}"
done

gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "${current_branch}" == "${BRANCH}" ]] || die "expected branch ${BRANCH}, on ${current_branch}"

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is dirty. Commit or stash before releasing."
fi

run "git fetch ${REMOTE} --tags --quiet"

# ------------------------------------------------------------------
# Compute new version
# ------------------------------------------------------------------
log "Computing new version"

current_version="$(node -p "require('./package.json').version")"
echo "Current version: ${current_version}"

if [[ "${BUMP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  new_version="${BUMP}"
else
  IFS=. read -r maj min pat <<<"${current_version}"
  case "${BUMP}" in
    major) maj=$((maj+1)); min=0; pat=0 ;;
    minor) min=$((min+1)); pat=0 ;;
    patch) pat=$((pat+1)) ;;
    *) die "invalid --bump value: ${BUMP}" ;;
  esac
  new_version="${maj}.${min}.${pat}"
fi
echo "New version:     ${new_version}"

tag="v${new_version}"
if git rev-parse "${tag}" >/dev/null 2>&1; then
  die "tag ${tag} already exists"
fi

# ------------------------------------------------------------------
# Build changelog section from git log since last tag
# ------------------------------------------------------------------
log "Generating changelog for ${tag}"

last_tag="$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)"
if [[ -n "${last_tag}" ]]; then
  range="${last_tag}..HEAD"
  echo "Range: ${range}"
else
  range=""
  echo "Range: full history (no previous v* tag)"
fi

# Collect commits, group by Conventional Commit type.
mapfile -t commits < <(git log --no-merges --pretty=format:'%s' ${range})

declare -A groups=(
  [feat]="Features"
  [fix]="Bug Fixes"
  [perf]="Performance"
  [refactor]="Refactor"
  [docs]="Documentation"
  [test]="Tests"
  [build]="Build"
  [ci]="CI"
  [chore]="Chores"
  [style]="Style"
)
order=(feat fix perf refactor docs test build ci chore style)

declare -A bucketed
cc_re='^([a-z]+)(\([^)]*\))?!?:[[:space:]]*(.+)$'
for c in "${commits[@]}"; do
  if [[ "${c}" =~ $cc_re ]]; then
    type="${BASH_REMATCH[1]}"
    msg="${BASH_REMATCH[3]}"
  else
    type="other"
    msg="${c}"
  fi
  [[ -n "${groups[${type}]:-}" ]] || type="other"
  bucketed[${type}]+="- ${msg}"$'\n'
done

today="$(date -u +%Y-%m-%d)"
section_file="$(mktemp)"
{
  printf '## %s — %s\n\n' "${tag}" "${today}"
  any=0
  for t in "${order[@]}"; do
    if [[ -n "${bucketed[${t}]:-}" ]]; then
      printf '### %s\n\n%s\n' "${groups[${t}]}" "${bucketed[${t}]}"
      any=1
    fi
  done
  if [[ -n "${bucketed[other]:-}" ]]; then
    printf '### Other\n\n%s\n' "${bucketed[other]}"
    any=1
  fi
  [[ "${any}" -eq 1 ]] || printf '_No notable changes._\n\n'
} >"${section_file}"

echo "--- changelog section ---"
cat "${section_file}"
echo "--- end changelog section ---"

# ------------------------------------------------------------------
# Confirm before mutating anything
# ------------------------------------------------------------------
confirm "Proceed with release ${tag}?" || die "aborted by user"

# ------------------------------------------------------------------
# Bump versions
# ------------------------------------------------------------------
log "Bumping versions to ${new_version}"

bump_versions() {
  # package.json + package-lock.json (npm version writes both, no tag/commit).
  ( cd "${REPO_ROOT}" && npm version "${new_version}" --no-git-tag-version --allow-same-version >/dev/null )
}

if [[ "${DRY_RUN}" -eq 1 ]]; then
  printf '   [dry-run] bump versions in package.json, package-lock.json\n'
else
  bump_versions
fi

# ------------------------------------------------------------------
# Update CHANGELOG.md (prepend new section)
# ------------------------------------------------------------------
log "Updating CHANGELOG.md"

changelog="${REPO_ROOT}/CHANGELOG.md"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  printf '   [dry-run] prepend section to %s\n' "${changelog}"
else
  tmp="$(mktemp)"
  if [[ ! -f "${changelog}" ]]; then
    printf '# Changelog\n\nAll notable changes to this project are documented here.\n\n' >"${tmp}"
    cat "${section_file}" >>"${tmp}"
  else
    # Preserve a leading "# Changelog" header if present.
    if head -n1 "${changelog}" | grep -q '^# '; then
      head -n1 "${changelog}" >"${tmp}"
      printf '\n' >>"${tmp}"
      cat "${section_file}" >>"${tmp}"
      tail -n +2 "${changelog}" >>"${tmp}"
    else
      cat "${section_file}" "${changelog}" >"${tmp}"
    fi
  fi
  mv "${tmp}" "${changelog}"
fi

# ------------------------------------------------------------------
# Build the .deb
# ------------------------------------------------------------------
log "Building .deb (this can take a while)"

build_args=()
[[ "${SKIP_TESTS}" -eq 1 ]] && build_args+=(--skip-tests)
[[ "${SKIP_APT}"   -eq 1 ]] && build_args+=(--skip-apt)

run "bash '${SCRIPT_DIR}/build-deb.sh' ${build_args[*]:-}"

DEB_DIR="${REPO_ROOT}/dist"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  deb_file="${DEB_DIR}/whats_${new_version}_amd64.deb"
  printf '   [dry-run] expecting deb at %s\n' "${deb_file}"
else
  shopt -s nullglob
  debs=("${DEB_DIR}"/whats*${new_version}*.deb "${DEB_DIR}"/whats*.deb)
  shopt -u nullglob
  [[ "${#debs[@]}" -ge 1 ]] || die "no .deb matching version ${new_version} in ${DEB_DIR}"
  deb_file="${debs[0]}"
  echo "Built: ${deb_file}"
fi

# ------------------------------------------------------------------
# Commit, tag, push
# ------------------------------------------------------------------
log "Committing, tagging, pushing"

run "git add package.json package-lock.json CHANGELOG.md"
run "git commit -m 'chore(release): ${tag}'"
run "git tag -a ${tag} -m '${tag}'"
run "git push ${REMOTE} ${BRANCH}"
run "git push ${REMOTE} ${tag}"

# ------------------------------------------------------------------
# GitHub release
# ------------------------------------------------------------------
log "Publishing GitHub release"

gh_args=(release create "${tag}" --title "${tag}" --notes-file "${section_file}")
[[ "${DRAFT}" -eq 1 ]]      && gh_args+=(--draft)
[[ "${PRERELEASE}" -eq 1 ]] && gh_args+=(--prerelease)
gh_args+=("${deb_file}")

if [[ "${DRY_RUN}" -eq 1 ]]; then
  printf '   [dry-run] gh %s\n' "${gh_args[*]}"
else
  gh "${gh_args[@]}"
fi

rm -f "${section_file}"

printf '\n\033[1;32mRelease %s complete.\033[0m\n' "${tag}"
