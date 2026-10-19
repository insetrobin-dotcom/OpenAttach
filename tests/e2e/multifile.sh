#!/data/data/com.termux/files/usr/bin/bash
# Dev-only smoke test for OpenAttach's multi-file flow.
# Expects this Android/Termux device: tmux, opencode-termux on PATH, python3, base64.
# It drives a real TUI in tmux with a stub picker (OC_UPLOAD_PICKER) and asserts
# the delivered message in the opencode sqlite DB.
#
# Usage: bash tests/e2e/multifile.sh [two|single|dismiss|empty]
#   two     - pick 2 files (Add another), Send now, type "multi test" -> 2 files in message
#   single  - pick 1 file, Send now, type "multi test" -> 1 file in message
#   dismiss - pick 1 file, Add another, stub silently produces nothing -> first file still sends
#   empty   - pick 2 files, Send now, press Enter with no text -> files still send
set -euo pipefail

MODE=${1:-two}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${PREFIX:-/data/data/com.termux/files/usr}/tmp/openattach-e2e
TMUX_SESSION=oa-e2e
CLI_JSON=$HOME/.config/opencode/cli.json

# 1x1 transparent PNG.
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

cleanup() {
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  if [ -f "$CLI_JSON.e2ebak" ]; then mv "$CLI_JSON.e2ebak" "$CLI_JSON"; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }
capture() { tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null; }
wait_for() { # text max_half_seconds
  local text=$1 max=$2 i=0
  while [ "$i" -lt "$max" ]; do
    capture | grep -qF -- "$text" && return 0
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

mkdir -p "$WORK/run"
python3 -c 'import time; print(time.time())' > "$WORK/started_at"

# Stub picker: writes a png to "$1". Counter makes each pick a distinct file.
cat > "$WORK/stub" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
C=\$(cat "$WORK/counter" 2>/dev/null || echo 0); C=\$((C + 1)); echo \$C > "$WORK/counter"
if [ "$MODE" = dismiss ] && [ "\$C" -gt 1 ]; then exit 0; fi
printf '%s' '$PNG_B64' | base64 -d > "\$1"
printf 'call %s' "\$C" >> "\$1"
EOF
chmod +x "$WORK/stub"

# The test plugin must be the only CLI plugin: back up the user's cli.json and blank it.
cp "$CLI_JSON" "$CLI_JSON.e2ebak"
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.config/opencode/cli.json')
d = json.load(open(p)); d['plugins'] = []
json.dump(d, open(p, 'w'), indent=2)
PY

tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
tmux new-session -d -s "$TMUX_SESSION" -x 100 -y 30 -c "$WORK/run" \
  "OPENCODE_CLI_CONFIG_CONTENT='{\"plugins\":[\"$REPO\"]}' OC_UPLOAD_PICKER=$WORK/stub opencode-termux"
wait_for 'ctrl+p commands' 120 || fail 'TUI did not start'

# First pick, then the multi-file select dialog.
tmux send-keys -t "$TMUX_SESSION" C-x f
if ! wait_for 'Send now' 40; then
  fail "no select dialog with 'Send now' — current code is single-file (expected RED before the Task 2 rewrite)"
fi
if [ "$MODE" = dismiss ]; then
  tmux send-keys -t "$TMUX_SESSION" Down Enter # "Add another file" → silent stub pick
  # Second pick produces nothing: the flow should keep the first file and go to the prompt.
  wait_for 'to chat' 60 || fail 'dismiss: prompt dialog did not appear after the silent second pick'
elif [ "$MODE" = single ]; then
  tmux send-keys -t "$TMUX_SESSION" Enter # "Send now" is the first option
  wait_for 'to chat' 60 || fail 'single: prompt dialog missing after Send now'
else
  tmux send-keys -t "$TMUX_SESSION" Down Enter # "Add another file"
  wait_for '2 files ready' 40 || fail 'no second select dialog after Add another'
  tmux send-keys -t "$TMUX_SESSION" Enter # "Send now" is the first option
  wait_for 'to chat' 60 || fail 'prompt dialog missing after Send now'
fi

if [ "$MODE" = empty ]; then
  tmux send-keys -t "$TMUX_SESSION" Enter # empty message
else
  tmux send-keys -t "$TMUX_SESSION" 'multi test'
  tmux send-keys -t "$TMUX_SESSION" Enter
fi

assert_sent() { # expected_text expected_files
  python3 - "$WORK" "$1" "$2" <<'PY'
import json, os, sqlite3, sys
work, want_text, want_files = sys.argv[1], sys.argv[2], int(sys.argv[3])
marker = int(float(open(os.path.join(work, 'started_at')).read()) * 1000)
db = os.path.expanduser('~/.local/share/opencode/opencode.db')
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
row = con.execute(
    'select id from session_v2 where time_created >= ? order by time_created desc limit 1',
    (marker,),
).fetchone()
assert row, 'no session created by the upload flow'
sid = row[0]
row = con.execute(
    "select data from session_message where session_id = ? and type = 'user' order by seq desc limit 1",
    (sid,),
).fetchone()
assert row, 'no user message in the test session'
d = json.loads(row[0])
files = d.get('files') or []
assert len(files) == want_files, f'expected {want_files} files, got {len(files)}'
text = d.get('text', '')
if want_text == 'EMPTY':
    assert text in ('', '📎'), f'unexpected text: {text!r}'
else:
    assert text == want_text, f'text mismatch: {text!r}'
paths = []
for f in files:
    uri = f.get('uri') or (f.get('source') or {}).get('uri') or ''
    path = uri.removeprefix('file://')
    assert os.path.exists(path), f'file missing on disk: {path}'
    paths.append(path)
open(os.path.join(work, 'sent_files'), 'w').write('\n'.join(paths))
print(f'OK session {sid} files={len(files)} text={text!r}')
PY
}

ok=0
for _ in $(seq 1 40); do
  if assert_sent "$([ "$MODE" = empty ] && echo EMPTY || echo 'multi test')" \
      "$(case "$MODE" in dismiss|single) echo 1;; *) echo 2;; esac)"; then ok=1; break; fi
  sleep 0.5
done
[ "$ok" = 1 ] || fail 'message was not delivered as expected'

# Cleanup: delete the test session and its test files (best effort).
python3 - "$WORK" <<'PY'
import base64, json, os, sqlite3, sys, urllib.request
work = sys.argv[1]
marker = int(float(open(os.path.join(work, 'started_at')).read()) * 1000)
db = os.path.expanduser('~/.local/share/opencode/opencode.db')
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
ids = [r[0] for r in con.execute('select id from session_v2 where time_created >= ?', (marker,))]
try:
    pw = json.load(open(os.path.expanduser('~/.config/opencode/service.json')))['password']
    auth = base64.b64encode(f'opencode:{pw}'.encode()).decode()
    for sid in ids:
        req = urllib.request.Request(
            f'http://127.0.0.1:49374/api/session/{sid}',
            method='DELETE',
            headers={'Authorization': f'Basic {auth}'},
        )
        urllib.request.urlopen(req, timeout=10)
except Exception as e:
    print('session cleanup skipped:', e)
PY
rm -f $(cat "$WORK/sent_files" 2>/dev/null) 2>/dev/null || true

echo "PASS ($MODE)"
