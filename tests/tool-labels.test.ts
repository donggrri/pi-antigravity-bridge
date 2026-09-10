import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { formatToolLabel } from "../src/tool-labels.js";

describe("formatToolLabel", () => {
	// --- view_file / read_file -----------------------------------------------

	test("view_file with AbsolutePath shows shortened path", () => {
		const label = formatToolLabel("view_file", JSON.stringify({
			AbsolutePath: "/home/dongjin/pi-antigravity-bridge/src/models.ts",
		}));
		assert.match(label, /\[agy read: .+models\.ts\]/);
		assert.ok(!label.includes("[agy tool:"), `should not use fallback: ${label}`);
	});

	test("read_file alias also works", () => {
		const label = formatToolLabel("read_file", JSON.stringify({
			AbsolutePath: "/tmp/test.txt",
		}));
		assert.match(label, /\[agy read:/);
	});

	// --- run_command ---------------------------------------------------------

	test("run_command with CommandLine shows the command", () => {
		const label = formatToolLabel("run_command", JSON.stringify({
			CommandLine: "npm test",
			Cwd: "/home/dongjin/project",
		}));
		assert.equal(label, "[agy bash: npm test]");
	});

	test("run_command truncates very long commands", () => {
		const longCmd = "a".repeat(200);
		const label = formatToolLabel("run_command", JSON.stringify({
			CommandLine: longCmd,
		}));
		assert.ok(label.length < 100, `label should be truncated: ${label.length}`);
		assert.ok(label.endsWith("…]"));
	});

	// --- grep_search ---------------------------------------------------------

	test("grep_search with Query and SearchPath", () => {
		const label = formatToolLabel("grep_search", JSON.stringify({
			Query: "gemini-3.8",
			SearchPath: "/home/dongjin/pi-antigravity-bridge/src",
		}));
		assert.match(label, /\[agy grep: "gemini-3\.8" in .+\]/);
	});

	test("grep_search with Query only", () => {
		const label = formatToolLabel("grep_search", JSON.stringify({
			Query: "hello world",
		}));
		assert.equal(label, '[agy grep: "hello world"]');
	});

	// --- find_by_name --------------------------------------------------------

	test("find_by_name with Pattern and SearchDirectory", () => {
		const label = formatToolLabel("find_by_name", JSON.stringify({
			Pattern: "*.test.ts",
			SearchDirectory: "/home/dongjin/project/tests",
		}));
		assert.match(label, /\[agy find: \*\.test\.ts in .+\]/);
	});

	// --- list_dir ------------------------------------------------------------

	test("list_dir with DirectoryPath", () => {
		const label = formatToolLabel("list_dir", JSON.stringify({
			DirectoryPath: "/home/dongjin/.pi/agent",
		}));
		assert.match(label, /\[agy ls: .+\]/);
	});

	// --- manage_task ---------------------------------------------------------

	test("manage_task with Action and TaskId", () => {
		const label = formatToolLabel("manage_task", JSON.stringify({
			Action: "status",
			TaskId: "task-15",
		}));
		assert.equal(label, "[agy task: status task-15]");
	});

	test("manage_task with Action only", () => {
		const label = formatToolLabel("manage_task", JSON.stringify({
			Action: "list",
		}));
		assert.equal(label, "[agy task: list]");
	});

	// --- search_web ----------------------------------------------------------

	test("search_web with query", () => {
		const label = formatToolLabel("search_web", JSON.stringify({
			query: "gemini 3.8 release date",
		}));
		assert.equal(label, '[agy web: "gemini 3.8 release date"]');
	});

	// --- read_url_content ----------------------------------------------------

	test("read_url_content with Url", () => {
		const label = formatToolLabel("read_url_content", JSON.stringify({
			Url: "https://example.com/docs/api",
		}));
		assert.equal(label, "[agy fetch: https://example.com/docs/api]");
	});

	// --- invoke_subagent -----------------------------------------------------

	test("invoke_subagent with Role", () => {
		const label = formatToolLabel("invoke_subagent", JSON.stringify({
			Subagents: [{ TypeName: "research", Role: "Codebase Researcher" }],
		}));
		assert.equal(label, "[agy subagent: Codebase Researcher]");
	});

	// --- generate_image ------------------------------------------------------

	test("generate_image with ImageName", () => {
		const label = formatToolLabel("generate_image", JSON.stringify({
			ImageName: "login_page_mockup",
		}));
		assert.equal(label, "[agy image: login_page_mockup]");
	});

	// --- fallback for unknown tools ------------------------------------------

	test("unknown tool falls back to [agy tool: name]", () => {
		const label = formatToolLabel("some_new_tool", JSON.stringify({ foo: "bar" }));
		assert.equal(label, "[agy tool: some_new_tool]");
	});

	// --- edge cases: empty / malformed JSON ----------------------------------

	test("empty inputJson falls back gracefully", () => {
		const label = formatToolLabel("view_file", "");
		assert.equal(label, "[agy read: view_file]");
	});

	test("malformed JSON falls back gracefully", () => {
		const label = formatToolLabel("run_command", "{broken");
		assert.equal(label, "[agy bash: run_command]");
	});

	test("known tool with empty relevant field falls back to category:name", () => {
		const label = formatToolLabel("view_file", JSON.stringify({ unrelated: 123 }));
		assert.equal(label, "[agy read: view_file]");
	});
});
