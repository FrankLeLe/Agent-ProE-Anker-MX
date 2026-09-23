#!/usr/bin/env bash
# Build and serve an isolated QA preview with the pinned project-local Node 24.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
qa_node="$project_root/work/edge-qa-runtime/node"
qa_port="${1:-4173}"
qa_data_root="${EDGE_QA_DATA_ROOT:-work/edge-qa-data}"
if [[ ! -x "$qa_node" ]]; then
  printf 'Pinned QA Node 24 is missing: %s\n' "$qa_node" >&2
  exit 2
fi
if [[ ! "$qa_port" =~ ^[0-9]+$ ]] || (( qa_port < 1 || qa_port > 65535 )); then
  printf 'Port must be between 1 and 65535.\n' >&2
  exit 2
fi
if [[ "$qa_data_root" != "work/edge-qa-data" && "$qa_data_root" != "work/edge-qa-a00-data" ]]; then
  printf 'QA data must use an approved isolated work/edge-qa-* directory.\n' >&2
  exit 2
fi

cd "$project_root"
"$qa_node" scripts/build-h5.ts
exec "$qa_node" scripts/serve-h5.ts --port "$qa_port" --data-root "$qa_data_root"
