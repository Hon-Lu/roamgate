#!/bin/sh
set -eu

# A clean process environment and separate Herdr session prevent accidental reuse.
# They do not remove this OS user's access to personal files or agent histories.
demo_root=${ROAMGATE_DEMO_ROOT:-/tmp/roamgate-demo}
demo_scripts=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$demo_root" in
  /*) ;;
  *) printf '%s\n' 'ROAMGATE_DEMO_ROOT must be an absolute path.' >&2; exit 1 ;;
esac
mkdir -p "$demo_root/config"
exec env -i \
  PATH="$PATH" \
  XDG_CONFIG_HOME="$demo_root/config" \
  HERDR_CONFIG_PATH="$demo_scripts/herdr.toml" \
  SHELL=/bin/sh \
  TERM=xterm-256color \
  PS1='northstar $ ' \
  herdr --session roamgate-demo "$@"
