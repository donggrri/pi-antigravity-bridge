#!/usr/bin/env bash
# In-pi smoke test: verify pi's real extension loader accepts this extension
# and registers the antigravity/* models. This exercises pi's actual
# ProviderConfigInput validation and model discovery  -  the mock-API test
# (scripts/test-extension.ts) cannot, since it substitutes a fake ExtensionAPI.
#
# Extension loading:
#   - After `pi install git:…/pi-antigravity-bridge`, the bridge is already on
#     pi's load path. Do not pass `-e ./extensions` (double registration /
#     AskAntigravity tool conflict).
#   - From a git checkout without a git install, this script uses `-e ./extensions`.
#
# What this validates:
#   - extensions/index.ts loads without import/shape errors under pi
#   - registerProvider is accepted by pi's real registry
#   - discoverAgyModels returns Gemini entries (or the fallback populates)
#   - the antigravity/* ids appear in `pi --list-models`
#
# What this does NOT validate (and why):
#   Print-mode can hang in some containers (upstream issue #318). The turn
#   logic itself is validated by scripts/test-provider.ts, which drives
#   streamSimple directly against a real agy run and asserts the full event
#   lifecycle.
#
# Usage: npm run smoke:pi   (or: bash scripts/smoke-in-pi.sh)

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pi >/dev/null 2>&1; then
	echo "FAIL: pi binary not found on PATH" >&2
	exit 1
fi

# When the bridge is git-installed, pi already loads ./extensions from the package.
# Passing -e ./extensions again registers AskAntigravity twice and fails.
pi_cmd=(pi)
pi_ext_mode="installed (omit -e ./extensions)"

echo "smoke: antigravity models via pi's real loader (--list-models antigravity)"

set +e
output="$(timeout 30s "${pi_cmd[@]}" --list-models antigravity 2>&1)"
rc=$?
set -e
if [[ $rc -eq 124 ]]; then
	echo "FAIL: pi --list-models timed out after 30s (possible print-mode hang)" >&2
	exit 1
fi
if [[ $rc -ne 0 ]] || ! grep -q "antigravity" <<<"$output"; then
	pi_cmd=(pi -e ./extensions)
	pi_ext_mode="local checkout (-e ./extensions)"
	echo "smoke: using $pi_ext_mode"
	set +e
	output="$(timeout 30s "${pi_cmd[@]}" --list-models antigravity 2>&1)"
	rc=$?
	set -e
else
	echo "smoke: using $pi_ext_mode"
fi

if [[ $rc -eq 124 ]]; then
	echo "FAIL: pi --list-models timed out after 30s (possible print-mode hang)" >&2
	exit 1
fi
if [[ $rc -ne 0 ]]; then
	echo "FAIL: pi --list-models exited $rc" >&2
	if grep -q 'AskAntigravity" conflicts' <<<"$output"; then
		echo "Hint: bridge appears loaded twice; avoid -e ./extensions when installed via pi install git:…" >&2
	fi
	echo "$output" >&2
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

# Parse provider/model ids from list-models. pi may print either antigravity/slug
# on one token or provider + model in separate columns.
extract_antigravity_model_ids() {
	awk '
		{
			if (match($0, /antigravity\/[A-Za-z0-9._-]+/)) {
				print substr($0, RSTART, RLENGTH)
				next
			}
			if ($1 == "antigravity" && $2 != "" && $2 !~ /^(Model|model|Name|name|ID|id)$/) {
				print "antigravity/" $2
			}
		}
	'
}

pick_antigravity_model() {
	local ids="$1"
	local pref id
	for pref in gemini-3-8-flash gemini-4-argon gpt-oss-120b-medium; do
		id="$(grep -Fx "antigravity/$pref" <<<"$ids" | head -1 || true)"
		if [[ -n "$id" ]]; then
			echo "$id"
			return 0
		fi
	done
	head -1 <<<"$ids"
}

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
	local model_ids model_line
	model_ids="$(extract_antigravity_model_ids <<<"$output" | sort -u)"
	if [[ -z "$model_ids" ]]; then
		echo "FAIL: could not parse antigravity/model id from --list-models output (expected antigravity/slug or two columns)" >&2
		echo "--- list-models output ---" >&2
		echo "$output" >&2
		exit 1
	fi
	model_line="$(pick_antigravity_model "$model_ids")"
	if [[ -z "$model_line" ]]; then
		echo "FAIL: no antigravity model id available after parsing list-models" >&2
		exit 1
	fi

	set +e
	local print_out
	print_out="$(timeout 90s "${pi_cmd[@]}" -p "Reply with exactly: OK" --model "$model_line" 2>&1)"
	local print_rc=$?
	set -e
	if [[ $print_rc -eq 124 ]]; then
		echo "FAIL: pi -p timed out after 90s" >&2
		exit 1
	fi
	if [[ $print_rc -ne 0 ]]; then
		echo "FAIL: pi -p exited $print_rc" >&2
		if grep -q 'AskAntigravity" conflicts' <<<"$print_out"; then
			echo "Hint: omit -e ./extensions when the bridge is already installed via pi install git:…" >&2
		fi
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
