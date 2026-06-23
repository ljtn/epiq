#!/bin/sh
# epiq installer — downloads the prebuilt single-binary.
#
#   curl -fsSL https://raw.githubusercontent.com/ljtn/epiq/main/install.sh | sh
#
# Env overrides:
#   EPIQ_INSTALL_DIR   install location (default: $XDG_BIN_HOME or $HOME/.local/bin)
#   EPIQ_VERSION       tag to install, e.g. v0.7.5 (default: latest release)
set -eu

REPO="ljtn/epiq"
BIN_NAME="epiq"
INSTALL_DIR="${EPIQ_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"

err() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl is required"

# --- Detect platform -------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os_name="macos" ;;
  Linux)  os_name="linux" ;;
  *) err "unsupported OS: $os (use the npm package: npm i -g epiq)" ;;
esac

case "$arch" in
  x86_64|amd64)  arch_name="x64" ;;
  arm64|aarch64) arch_name="arm64" ;;
  *) err "unsupported architecture: $arch" ;;
esac

asset="${BIN_NAME}-${os_name}-${arch_name}"

# --- Resolve download URL --------------------------------------------------
if [ -n "${EPIQ_VERSION:-}" ]; then
  url="https://github.com/${REPO}/releases/download/${EPIQ_VERSION}/${asset}"
else
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
fi

# --- Download & install ----------------------------------------------------
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

printf 'Downloading %s...\n' "$asset"
curl -fsSL "$url" -o "$tmp" \
  || err "no prebuilt binary for ${os_name}-${arch_name} (asset: $asset). It may not be published for this platform yet."

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/$BIN_NAME"
trap - EXIT

printf 'Installed epiq to %s/%s\n' "$INSTALL_DIR" "$BIN_NAME"

# --- PATH hint -------------------------------------------------------------
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    printf '\nAdd it to your PATH:\n'
    printf '  export PATH="%s:$PATH"\n' "$INSTALL_DIR"
    printf '(add that line to your ~/.zshrc or ~/.bashrc to make it permanent)\n'
    ;;
esac

printf '\nRun: epiq\n'
