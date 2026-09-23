#!/usr/bin/env bash
# Run the persistent Windows Playwright/Edge check from this WSL workspace.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
windows_node="/mnt/c/Users/weiyu/AppData/Local/MixtureX/edge-qa/runtime/node-v24.21.0-win-x64/node.exe"
qa_url="${EDGE_QA_URL:-http://localhost:4173/}"
qa_tab="${1:-assistant}"
qa_name="${2:-assistant-home}"
qa_action="${3:-}"
qa_device="${4:-screen}"
qa_output_dir="$project_root/work/edge-qa-captures"
qa_screen_output="$qa_output_dir/$qa_name-screen.png"
qa_output="$qa_output_dir/$qa_name.png"

if [[ ! -f "$windows_node" ]]; then
  printf 'Windows Edge QA runtime is missing: %s\n' "$windows_node" >&2
  exit 2
fi
if [[ ! "$qa_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Capture name must use letters, digits, underscores, or hyphens.\n' >&2
  exit 2
fi
if [[ "$qa_device" != "screen" && "$qa_device" != "iphone" ]]; then
  printf 'Device must be screen or iphone.\n' >&2
  exit 2
fi
if ! curl --fail --silent --show-error --output /dev/null "$qa_url"; then
  printf 'Local preview is not responding at %s\n' "$qa_url" >&2
  exit 2
fi

mkdir -p "$qa_output_dir"
if [[ "$qa_device" == "iphone" ]]; then
  qa_args=(--url "$qa_url" --tab "$qa_tab" --width 393 --height 852 --scale 2 --output "$(wslpath -w "$qa_screen_output")")
else
  qa_args=(--url "$qa_url" --tab "$qa_tab" --output "$(wslpath -w "$qa_output")")
fi
if [[ -n "$qa_action" ]]; then
  qa_args+=(--click-action "$qa_action")
fi
if [[ "${EDGE_QA_CAPTURE_EACH_ACTION:-false}" == "true" ]]; then
  qa_args+=(--capture-each-action true --capture-names "${EDGE_QA_CAPTURE_NAMES:-}")
fi
"$windows_node" "$(wslpath -w "$project_root/scripts/edge-qa.cjs")" "${qa_args[@]}"
if [[ "$qa_device" == "iphone" ]]; then
  qa_status_time="$(TZ=Asia/Shanghai date +'%l:%M' | sed 's/^ //')"
  magick -size 1022x1936 xc:'#e9e5de' \
    \( "$qa_screen_output" -resize 786x1704\! \) -geometry +118+116 -composite \
    \( "$project_root/scripts/assets/iphone/ios-status-icons.svg" -resize 158x26\! \) -geometry +678+136 -composite \
    -font "$(fc-match -f '%{file}' sans | head -n 1)" -pointsize 30 -fill '#15171b' -draw "text 190,166 '$qa_status_time'" \
    \( "$project_root/scripts/assets/iphone/Bezel.png" -resize 1022x1936\! \) -compose over -composite \
    "$qa_output"
  printf 'iPhone frame: %s\n' "$qa_output"
fi
