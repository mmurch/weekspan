#!/usr/bin/env bash
#
# Install (or update) weekspan into ~/weekspan.
#
# This script ships INSIDE the release zip, so the artifact carries its own
# installer and there is nothing to remember on the receiving machine. Run it as
# many times as you like: it replaces the app and leaves your data alone.
#
# The one rule everything here is built around:
#
#     THE LEDGER IS NEVER TOUCHED.
#
# Updates replace weekspan.html and friends. `ledger/` — and anything else you
# put in the install directory — is left exactly as it was. There is no `rm -rf`
# of the destination anywhere in this file, deliberately: an installer that runs
# on every update is the last place you want a recursive delete.
#
# Usage:
#   ./install.sh              install or update
#   ./install.sh --rollback   put the previous version back
#
# Override the destination with WEEKSPAN_HOME=/some/path ./install.sh
set -euo pipefail

DEST="${WEEKSPAN_HOME:-$HOME/weekspan}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREV="$DEST/.previous"

# Everything the installer owns. Anything NOT on this list is never written and
# never removed, which is what makes `ledger/` safe by construction rather than
# by remembering to special-case it.
APP_FILES=(weekspan.html weekspan-cli.mjs weekspan.schema.json VERSION)
APP_DIRS=(templates)

say()  { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---- rollback ---------------------------------------------------------------
if [[ "${1:-}" == "--rollback" ]]; then
  [[ -d "$PREV" ]] || fail "no previous version saved at $PREV"
  for f in "${APP_FILES[@]}"; do
    [[ -e "$PREV/$f" ]] && cp -p "$PREV/$f" "$DEST/$f"
  done
  for d in "${APP_DIRS[@]}"; do
    if [[ -d "$PREV/$d" ]]; then
      rm -rf "${DEST:?}/$d"
      cp -Rp "$PREV/$d" "$DEST/$d"
    fi
  done
  say "Rolled back to $(cat "$DEST/VERSION" 2>/dev/null || echo 'unknown build')."
  exit 0
fi

# ---- sanity: is the payload actually beside us? -----------------------------
[[ -f "$HERE/weekspan.html" ]] || fail "weekspan.html is not next to this script.
Unzip the release first, then run ./install.sh from inside the unzipped folder."

VERSION="$(cat "$HERE/VERSION" 2>/dev/null || echo 'unknown')"
OLD="$(cat "$DEST/VERSION" 2>/dev/null || true)"

mkdir -p "$DEST"

# ---- keep one version back, so a bad build is one command from undone -------
if [[ -n "$OLD" ]]; then
  rm -rf "$PREV"
  mkdir -p "$PREV"
  for f in "${APP_FILES[@]}"; do
    [[ -e "$DEST/$f" ]] && cp -p "$DEST/$f" "$PREV/$f"
  done
  for d in "${APP_DIRS[@]}"; do
    [[ -d "$DEST/$d" ]] && cp -Rp "$DEST/$d" "$PREV/$d"
  done
fi

# ---- install ----------------------------------------------------------------
for f in "${APP_FILES[@]}"; do
  [[ -e "$HERE/$f" ]] && cp -p "$HERE/$f" "$DEST/$f"
done
for d in "${APP_DIRS[@]}"; do
  if [[ -d "$HERE/$d" ]]; then
    rm -rf "${DEST:?}/$d"
    cp -Rp "$HERE/$d" "$DEST/$d"
  fi
done

# macOS tags anything that arrived via a browser or Slack as quarantined. For an
# HTML file that only means an extra prompt, but clearing it keeps the app from
# looking broken on first open.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
fi

mkdir -p "$DEST/ledger"

# ---- a ledger to open, if there isn't one yet -------------------------------
# Only ever CREATES a missing one. An existing ledger is not read, not rewritten,
# not migrated.
LEDGER="$DEST/ledger/personal.weekspan.json"
CREATED_LEDGER=""
if [[ ! -e "$LEDGER" ]] && ! ls "$DEST"/ledger/*.weekspan.json >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then
    node "$DEST/weekspan-cli.mjs" init --weekspan "$LEDGER" >/dev/null 2>&1 && CREATED_LEDGER="$LEDGER"
  fi
fi

# ---- report ------------------------------------------------------------------
say ""
if [[ -z "$OLD" ]]; then
  say "Installed weekspan $VERSION -> $DEST"
elif [[ "$OLD" == "$VERSION" ]]; then
  say "Reinstalled weekspan $VERSION -> $DEST  (same build as before)"
else
  say "Updated weekspan  $OLD  ->  $VERSION   in $DEST"
  say "  (previous build kept; './install.sh --rollback' restores it)"
fi
say ""
say "App:    $DEST/weekspan.html"
if [[ -n "$CREATED_LEDGER" ]]; then
  say "Ledger: $CREATED_LEDGER   (new, empty)"
else
  say "Ledger: $DEST/ledger/   (left untouched)"
fi
say ""
say "Open it in Chrome or Edge — Firefox and Safari cannot write the ledger:"
say ""
if [[ "$(uname)" == "Darwin" ]]; then
  say "    open -a 'Google Chrome' $DEST/weekspan.html"
else
  say "    xdg-open $DEST/weekspan.html"
fi
say ""
say "The footer shows the build, so you can confirm this update actually landed."
