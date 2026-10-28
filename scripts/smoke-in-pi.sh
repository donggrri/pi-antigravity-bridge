#!/usr/bin/env bash
# In-pi smoke test: verify pi's real extension loader accepts this extension
# and registers the antigravity/* models. This exercises pi's actual
# ProviderConfigInput validation and model discovery  -  the mock-API test
# (scripts/test-extension.ts) cannot, since it substitutes a fake ExtensionAPI.
#
# What this validates:
#   - extensions/index.ts loads without import/shape errors under pi
#   - registerProvider is accepted by pi's real registry
#   - discoverAgyModels returns Gemini entries (or the fallback populates)
#   - the antigravity/* ids appear in `pi --list-models`
#
# What this does NOT validate (and why):
#   A full print-mode turn (`pi -e ./extensions -p ... --model antigravity/...`).
#   In this container pi print mode hangs for BOTH built-in providers and this
#   extension (zero stdout/stderr, exits by timeout). The turn logic itself is
#   validated by scripts/test-provider.ts, which drives streamSimple directly
#   against a real agy run and asserts the full event lifecycle.
#
# Usage: npm run smoke:pi   (or: bash scripts/smoke-in-pi.sh)

set -euo pipefail

cd "$(dirname "$0")/.."

echo "smoke: loading extension through pi's real loader (--list-models antigravity)"

if ! command -v pi >/dev/null 2>&1; then
	echo "FAIL: pi binary not found on PATH" >&2
	exit 1
fi

# Bound the call: pi print mode is known to hang in some environments (issue
# #318). Without a timeout this smoke test would block forever instead of
# failing fast. 124 = timeout -> treat as a diagnosable failure. Temporarily
# disable set -e so a non-zero/timeout exit reaches the rc checks below
# instead of aborting the script at the assignment.
set +e
output="$(timeout 30s pi -e ./extensions --list-models antigravity 2>&1)"
rc=$?
set -e
if [[ $rc -eq 124 ]]; then
	echo "FAIL: pi --list-models timed out after 30s (possible print-mode hang)" >&2
	exit 1
fi
if [[ $rc -ne 0 ]]; then
	echo "FAIL: pi --list-models exited $rc" >&2
	exit 1
fi

if [[ -z "$output" ]]; then
	echo "FAIL: pi produced no output for --list-models antigravity" >&2
	exit 1
fi

if ! grep -q "antigravity" <<<"$output"; then
	echo "FAIL: no antigravity models in pi's model list" >&2
	echo "--- output ---" >&2
	echo "$output" >&2
	exit 1
fi

count="$(grep -c "antigravity" <<<"$output")"
echo "PASS: $count antigravity model line(s) registered via pi's loader"
echo
echo "registered:"
grep "antigravity" <<<"$output"

# Optional print-mode smoke: one non-interactive turn when agy is authenticated.
# Skips quietly when agy is missing or `agy models` fails (no OAuth in CI).
# Set SMOKE_PI_PRINT=1 to require this step (fail if agy unavailable).
smoke_print_mode() {
	local require="${SMOKE_PI_PRINT:-}"
	if [[ "$require" != "1" ]]; then
		if ! command -v agy >/dev/null 2>&1; then
			echo "SKIP: print-mode smoke (agy not on PATH; set SMOKE_PI_PRINT=1 to require)"
			return 0
		fi
		set +e
		timeout 20s agy models >/dev/null 2>&1
		local agy_rc=$?
		set -e
		if [[ $agy_rc -ne 0 ]]; then
			echo "SKIP: print-mode smoke (agy models failed; authenticate agy or set SMOKE_PI_PRINT=1 to require)"
			return 0
		fi
	elif ! command -v agy >/dev/null 2>&1; then
		echo "FAIL: SMOKE_PI_PRINT=1 but agy not on PATH" >&2
		exit 1
	elif ! timeout 20s agy models >/dev/null 2>&1; then
		echo "FAIL: SMOKE_PI_PRINT=1 but agy models failed (auth/network?)" >&2
		exit 1
	fi

	echo
	echo "smoke: pi -p one-line turn (agy authenticated)"
	local model_line
	model_line="$(grep -m1 "antigravity/" <<<"$output" | awk '{print $1}')"
	if [[ -z "$model_line" ]]; then
		model_line="antigravity/gemini-3-6-flash-medium"
	fi
	set +e
	local print_out
	print_out="$(timeout 90s pi -e ./extensions -p "Reply with exactly: OK" --model "$model_line" 2>&1)"
	local print_rc=$?
	set -e
	if [[ $print_rc -eq 124 ]]; then
		echo "FAIL: pi -p timed out after 90s" >&2
		exit 1
	fi
	if [[ $print_rc -ne 0 ]]; then
		echo "FAIL: pi -p exited $print_rc" >&2
		echo "$print_out" >&2
		exit 1
	fi
	if [[ -z "$print_out" ]]; then
		echo "FAIL: pi -p produced no output" >&2
		exit 1
	fi
	echo "PASS: pi -p completed with model $model_line"
}

smoke_print_mode
