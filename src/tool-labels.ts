// Format agy tool events into human-friendly labels for pi's thinking stream.
//
// agy's tool loop is closed (it runs tools itself, not through pi), so tool
// activity is surfaced as text inside thinking blocks. This module replaces
// the bare "[agy tool: view_file]" with a descriptive label that shows WHAT
// the tool is doing, e.g. "[agy read: src/models.ts]".
//
// Design:
//   - Pure function: no I/O, no side effects → unit-testable.
//   - Safe fallback: parse failure → "[agy tool: <name>]" (unchanged behavior).
//   - Path shortening: absolute paths are reduced to basename or cwd-relative.
//   - Length cap: labels are truncated to MAX_DETAIL_LEN to keep output tidy.

import path from "node:path";

const MAX_DETAIL_LEN = 80;

/** Truncate a string to `max` chars, adding "…" when truncated. */
function truncate(s: string, max: number = MAX_DETAIL_LEN): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Shorten an absolute path: prefer cwd-relative, else basename.
 *  A relative path or empty string is returned as-is. */
function shortenPath(absPath: string): string {
	if (!absPath) return "";
	if (!path.isAbsolute(absPath)) return absPath;
	try {
		const rel = path.relative(process.cwd(), absPath);
		// If relative path doesn't start with too many "..", prefer it.
		const depth = (rel.match(/\.\.\//g) ?? []).length;
		return depth <= 2 ? rel : path.basename(absPath);
	} catch {
		return path.basename(absPath);
	}
}

/** Safely parse JSON, returning null on failure. */
function safeParse(json: string): Record<string, unknown> | null {
	if (!json) return null;
	try {
		const obj = JSON.parse(json);
		return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
	} catch {
		return null;
	}
}

/** Extract a string value from a parsed JSON object by key (case-insensitive). */
function str(obj: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const val = obj[key];
		if (typeof val === "string" && val.length > 0) return val;
	}
	return "";
}

// --- Tool formatters --------------------------------------------------------
// Each returns a detail string or "" when the input doesn't carry useful info.
// The caller wraps it in the "[agy <category>: <detail>]" bracket.

type Formatter = (obj: Record<string, unknown>) => string;

const formatters: Record<string, { category: string; format: Formatter }> = {
	view_file: {
		category: "read",
		format: (o) => shortenPath(str(o, "AbsolutePath", "path", "file")),
	},
	read_file: {
		category: "read",
		format: (o) => shortenPath(str(o, "AbsolutePath", "path", "file")),
	},
	run_command: {
		category: "bash",
		format: (o) => {
			const cmd = str(o, "CommandLine", "command");
			return truncate(cmd);
		},
	},
	grep_search: {
		category: "grep",
		format: (o) => {
			const query = str(o, "Query", "query");
			const searchPath = shortenPath(str(o, "SearchPath", "path"));
			if (query && searchPath) return truncate(`"${query}" in ${searchPath}`);
			if (query) return truncate(`"${query}"`);
			return "";
		},
	},
	find_by_name: {
		category: "find",
		format: (o) => {
			const pattern = str(o, "Pattern", "pattern");
			const dir = shortenPath(str(o, "SearchDirectory", "directory"));
			if (pattern && dir) return truncate(`${pattern} in ${dir}`);
			if (pattern) return truncate(pattern);
			return "";
		},
	},
	list_dir: {
		category: "ls",
		format: (o) => shortenPath(str(o, "DirectoryPath", "path", "directory")),
	},
	manage_task: {
		category: "task",
		format: (o) => {
			const action = str(o, "Action", "action");
			const taskId = str(o, "TaskId", "taskId");
			if (action && taskId) return `${action} ${taskId}`;
			if (action) return action;
			return "";
		},
	},
	search_web: {
		category: "web",
		format: (o) => {
			const query = str(o, "query", "Query", "q");
			return query ? truncate(`"${query}"`) : "";
		},
	},
	read_url_content: {
		category: "fetch",
		format: (o) => {
			const url = str(o, "Url", "url", "URL");
			return truncate(url);
		},
	},
	invoke_subagent: {
		category: "subagent",
		format: (o) => {
			// Subagents array — show the first role if available
			const subs = o.Subagents ?? o.subagents;
			if (Array.isArray(subs) && subs.length > 0) {
				const first = subs[0];
				const role = typeof first?.Role === "string" ? first.Role : "";
				return role ? truncate(role) : "";
			}
			return "";
		},
	},
	send_message: {
		category: "message",
		format: (o) => {
			const recipient = str(o, "Recipient", "recipient");
			return recipient ? truncate(recipient) : "";
		},
	},
	generate_image: {
		category: "image",
		format: (o) => {
			const name = str(o, "ImageName", "imageName");
			return name ? truncate(name) : "";
		},
	},
	ask_question: {
		category: "ask",
		format: () => "",
	},
	schedule: {
		category: "schedule",
		format: (o) => {
			const prompt = str(o, "Prompt", "prompt");
			return prompt ? truncate(prompt) : "";
		},
	},
};

/** Format a tool event into a human-friendly label string.
 *
 *  Returns the full bracketed label including the trailing newline-free text,
 *  e.g. `[agy read: src/models.ts]`. The caller appends `\n`.
 *
 *  When the tool name is not recognized or the inputJson is empty/malformed,
 *  falls back to `[agy tool: <name>]` (the pre-existing behavior). */
export function formatToolLabel(name: string, inputJson: string): string {
	const entry = formatters[name];
	if (!entry) return `[agy tool: ${name}]`;

	const obj = safeParse(inputJson);
	if (!obj) return `[agy ${entry.category}: ${name}]`;

	const detail = entry.format(obj);
	if (!detail) return `[agy ${entry.category}: ${name}]`;

	return `[agy ${entry.category}: ${detail}]`;
}
