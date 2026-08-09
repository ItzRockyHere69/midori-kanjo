#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}
command -v flock || {
  echo "build-verified.sh requires util-linux flock." >&2
  exit 69
}

project_root="$(cd "${SITES_PROJECT_ROOT}" && pwd)"
if [[ "${project_root}" == "/" ]]; then
  echo "Refusing to build with the filesystem root as SITES_PROJECT_ROOT." >&2
  exit 64
fi

lock_timeout="${SITES_BUILD_LOCK_TIMEOUT_SECONDS:-240}"
if [[ ! "${lock_timeout}" =~ ^[0-9]+$ ]]; then
  echo "SITES_BUILD_LOCK_TIMEOUT_SECONDS must be a whole number of seconds." >&2
  exit 64
fi

mkdir -p "${project_root}/.wrangler"
lock_file="${project_root}/.wrangler/sites-build.lock"
exec {build_lock_fd}>"${lock_file}"
echo "Waiting for the project build lock..."
if ! flock --timeout "${lock_timeout}" "${build_lock_fd}"; then
  echo "Another Sites build still holds the project lock after ${lock_timeout}s." >&2
  exit 75
fi

vinext="${project_root}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

# Vinext does not reliably remove outputs left by an interrupted or older
# build. Clean only this validated project's generated artifact while holding
# the lock, so a successful build can never publish orphaned hashed assets.
dist_directory="${project_root}/dist"
rm -rf -- "${dist_directory}"

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

SITES_PROJECT_ROOT="${project_root}" "${script_dir}/validate-artifact.sh"
