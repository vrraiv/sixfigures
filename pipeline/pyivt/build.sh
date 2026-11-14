#!/usr/bin/env bash
# Build the pyivt that reads the 2011 NHS and 2006 profile tables (make pyivt).
#
#   bash pipeline/pyivt/build.sh        # in WSL, Linux or macOS
#
# pyivt 0.0.5 cannot read these older Beyond 20/20 tables. This checks out the commit of
# pyivt the fix was written against, applies legacy-member-fields.patch (beside this
# script), and installs the result with pyarrow in a virtual environment of its own:
#
#   $PYIVT_DIR         the checkout                (default ~/pyivt)
#   $PYIVT_DIR/.venv   the environment to run with (PYIVT_PYTHON in the Makefile)
#
# Keep it off /mnt/c under WSL: the repository there is OneDrive-synced. Needs git,
# python3 with venv, a C compiler and Rust 1.88 or later (https://rustup.rs). Running it
# again is safe: a checkout already at the commit with the patch applied is only rebuilt.
set -euo pipefail

REPO=https://github.com/natebabyak/pyivt.git
COMMIT=ea428cc41752f6a9916f5f51c7a491263ae13995   # v0.0.5 + 11 commits, 30 October 2026
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PATCH=$HERE/legacy-member-fields.patch
DIR=${PYIVT_DIR:-$HOME/pyivt}

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null || {
    echo "No Rust toolchain (cargo). Install one, then run this again:" >&2
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal" >&2
    exit 1
}

[ -d "$DIR/.git" ] || git clone --quiet "$REPO" "$DIR"
cd "$DIR"
git cat-file -e "$COMMIT^{commit}" 2>/dev/null || git fetch --quiet origin
if [ "$(git rev-parse HEAD)" != "$COMMIT" ]; then
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        echo "$DIR has changes and is not at $COMMIT; move it aside or set PYIVT_DIR." >&2
        exit 1
    fi
    git checkout --quiet --detach "$COMMIT"
fi
# --ignore-whitespace: a Windows checkout of this repository may have given the patch CRLFs.
if git apply --ignore-whitespace --reverse --check "$PATCH" 2>/dev/null; then
    echo "patch already applied in $DIR"
else
    git apply --ignore-whitespace "$PATCH"
    echo "applied $(basename "$PATCH") to pyivt ${COMMIT:0:7} in $DIR"
fi

[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet "pyarrow>=14" .
.venv/bin/python - <<'EOF'
import pyarrow, pyivt
print(f"pyivt {pyivt.__version__} (patched) and pyarrow {pyarrow.__version__} in {pyivt.__file__.split('/lib/')[0]}")
EOF
echo "Run the extract scripts with $DIR/.venv/bin/python, e.g."
echo "  make PYIVT_PYTHON=$DIR/.venv/bin/python pipeline/extracts/toronto_nhs_2011.csv"
