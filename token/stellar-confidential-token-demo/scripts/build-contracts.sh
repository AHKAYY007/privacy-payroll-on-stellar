#!/usr/bin/env bash
# Builds every contract in contracts/ to wasm and copies the artifacts into
# contracts/out/ (git-ignored) under their crate names,
# confidential_<x>_example.wasm, where scripts/_shared.ts loads them.
#
# Also refreshes contracts/factory/testdata/ with the four wasms the factory
# deploys, so the factory's tests always run against the current sources.
#
# Requires the pinned stable Rust toolchain with the wasm32v1-none target
# (see contracts/rust-toolchain.toml) and stellar-cli >= 28.1.0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

OUT_DIR="$ROOT/contracts/out"
mkdir -p "$OUT_DIR"

echo "==> Building contracts with 'stellar contract build'"
# Not plain `cargo build`: soroban-sdk 28's build.rs aborts any wasm build
# that the stellar CLI did not start.
stellar contract build --out-dir "$OUT_DIR"

for wasm in "$OUT_DIR"/*.wasm; do
  echo "    wrote $wasm ($(wc -c < "$wasm") bytes)"
done

TESTDATA="$ROOT/contracts/factory/testdata"
for child in compliant_token allowlist_policy vanilla_token blocklist_policy; do
  cp "$OUT_DIR/confidential_${child}_example.wasm" "$TESTDATA/"
done
echo "    refreshed $TESTDATA"

echo "Done."
