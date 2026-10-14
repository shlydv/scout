#!/usr/bin/env bash
# One-time laptop bootstrap for Scout (oasis).
# Usage: ./scripts/bootstrap-new-machine.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="${HOME}/.local/node/bin:${HOME}/.local/bin:${PATH}"

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  echo "Created .env.local from example — fill Supabase keys before continuing."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.local
set +a

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL in .env.local"
  exit 1
fi

mkdir -p .cache
if [[ -f "${HOME}/Downloads/zepto-session.json" && ! -f .cache/zepto-session.json ]]; then
  cp "${HOME}/Downloads/zepto-session.json" .cache/zepto-session.json
  echo "Copied zepto-session.json → .cache/"
fi

echo "→ Applying migrations…"
pnpm db:migrate

echo "→ Supabase connectivity…"
pnpm diag:supabase

if [[ -n "${ZEPTO_CSV_PATH:-}" && -f "${ZEPTO_CSV_PATH}" ]]; then
  read -r -p "Import catalog from ${ZEPTO_CSV_PATH}? [y/N] " ans
  if [[ "${ans,,}" == "y" ]]; then
    pnpm catalog:sync
    pnpm catalog:backfill-visible
    pnpm seed:produce
    pnpm score
  fi
else
  echo "Set ZEPTO_CSV_PATH in .env.local to import catalog, or restore a pg_dump."
fi

echo "→ Production build check…"
pnpm build

echo "Done. Next: push to GitHub, link Vercel, set NEXT_PUBLIC_SITE_URL to your deployment URL."
