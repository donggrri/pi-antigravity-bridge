// Regression test for agy's response-row write race.
// Agy can commit a step_type=15 row before its nested text protobuf is ready.
// The runner must retry that row instead of advancing past and losing it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { runAgyTurn, type AgyEvent } from "../src/runner.js";

function writeFakeAgy(scriptPath: string, convDir: string): void {
	const script = `#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";

const dir = process.env.AGY_FAKE_INCOMPLETE_DIR;
if (!dir) { console.error("AGY_FAKE_INCOMPLETE_DIR unset"); process.exit(2); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dbPath = path.join(dir, randomUUID() + ".db");
const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE steps (idx integer, step_type integer NOT NULL, status integer NOT NULL, step_payload blob, PRIMARY KEY (idx))");
const update = db.prepare("UPDATE steps SET step_payload = ? WHERE idx = 0");
// Step 0 is inserted with a torn payload (field 20 length exceeds buffer).
db.prepare("INSERT INTO steps VALUES (0, 15, 3, ?)").run(Buffer.from("080f2003a201200a07", "hex"));
await sleep(650);
// Then agy completes the write with valid protobuf for RACE_OK.
update.run(Buffer.from("080f2003a201090a07524143455f4f4b", "hex"));
await sleep(250);
db.close();
`;
	fs.writeFileSync(scriptPath, script, { mode: 0o755 });
	void convDir;
}

function writeFakeLateTextAgy(scriptPath: string, convDir: string): void {
	const script = `#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";

const dir = process.env.AGY_FAKE_LATE_TEXT_DIR;
if (!dir) { console.error("AGY_FAKE_LATE_TEXT_DIR unset"); process.exit(2); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dbPath = path.join(dir, randomUUID() + ".db");
const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE steps (idx integer, step_type integer NOT NULL, status integer NOT NULL, step_payload blob, PRIMARY KEY (idx))");
// This is syntactically valid but has no field 20 text yet, like a planner
// response while agy is still finishing the response step.
db.prepare("INSERT INTO steps VALUES (0, 15, 3, ?)").run(Buffer.from("080f2003", "hex"));
await sleep(650);
db.prepare("UPDATE steps SET step_payload = ? WHERE idx = 0").run(Buffer.from("080f2003a2010b0a094c4154455f54455854", "hex"));
await sleep(250);
db.close();
`;
	fs.writeFileSync(scriptPath, script, { mode: 0o755 });
	void convDir;
}

function writeFakeToolAgy(scriptPath: string, convDir: string): void {
	const script = `#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";

const dir = process.env.AGY_FAKE_TOOL_DIR;
if (!dir) { console.error("AGY_FAKE_TOOL_DIR unset"); process.exit(2); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dbPath = path.join(dir, randomUUID() + ".db");
const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE steps (idx integer, step_type integer NOT NULL, status integer NOT NULL, step_payload blob, PRIMARY KEY (idx))");
// idx 0: thinking
db.prepare("INSERT INTO steps VALUES (0, 14, 3, ?)").run(Buffer.from("080e2003", "hex"));
// idx 1: planner response without agent text (tool call decision)
db.prepare("INSERT INTO steps VALUES (1, 15, 3, ?)").run(Buffer.from("080f2003", "hex"));
// idx 2: tool step (tool_type 132)
db.prepare("INSERT INTO steps VALUES (2, 132, 3, ?)").run(Buffer.from("08840120032a1a221812086c6973745f6469721a0c7b2270617468223a222e227d", "hex"));
// idx 3: final planner response with text
db.prepare("INSERT INTO steps VALUES (3, 15, 3, ?)").run(Buffer.from("080f2003a201090a07544f4f4c5f4f4b", "hex"));
await sleep(100);
db.close();
`;
	fs.writeFileSync(scriptPath, script, { mode: 0o755 });
	void convDir;
}

test("runAgyTurn retries an initially torn response payload", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-incomplete-"));
	const convDir = path.join(tmp, "conversations");
	fs.mkdirSync(convDir, { recursive: true });
	const fakeBin = path.join(tmp, "fake-agy.mjs");
	writeFakeAgy(fakeBin, convDir);
	process.env.AGY_FAKE_INCOMPLETE_DIR = convDir;

	try {
		const events: AgyEvent[] = [];
		const result = await runAgyTurn(
			{ cwd: tmp, prompt: "ignored", conversationsDir: convDir, binary: fakeBin, timeoutMin: 1 },
			event => events.push(event),
		);

		assert.equal(result.exitCode, 0);
		assert.deepEqual(events, [{ kind: "text", text: "RACE_OK" }]);
	} finally {
		delete process.env.AGY_FAKE_INCOMPLETE_DIR;
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("runAgyTurn retries a valid but initially textless response row", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-late-text-"));
	const convDir = path.join(tmp, "conversations");
	fs.mkdirSync(convDir, { recursive: true });
	const fakeBin = path.join(tmp, "fake-late-text-agy.mjs");
	writeFakeLateTextAgy(fakeBin, convDir);
	process.env.AGY_FAKE_LATE_TEXT_DIR = convDir;

	try {
		const events: AgyEvent[] = [];
		const result = await runAgyTurn(
			{ cwd: tmp, prompt: "ignored", conversationsDir: convDir, binary: fakeBin, timeoutMin: 1 },
			event => events.push(event),
		);

		assert.equal(result.exitCode, 0);
		assert.deepEqual(events, [{ kind: "text", text: "LATE_TEXT" }]);
	} finally {
		delete process.env.AGY_FAKE_LATE_TEXT_DIR;
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("runAgyTurn correctly advances past non-text planner steps and emits tool and final text", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-tool-"));
	const convDir = path.join(tmp, "conversations");
	fs.mkdirSync(convDir, { recursive: true });
	const fakeBin = path.join(tmp, "fake-tool-agy.mjs");
	writeFakeToolAgy(fakeBin, convDir);
	process.env.AGY_FAKE_TOOL_DIR = convDir;

	try {
		const events: AgyEvent[] = [];
		const result = await runAgyTurn(
			{ cwd: tmp, prompt: "ignored", conversationsDir: convDir, binary: fakeBin, timeoutMin: 1 },
			event => events.push(event),
		);

		assert.equal(result.exitCode, 0);
		assert.equal(result.lastIdx, 3);
		assert.deepEqual(events, [
			{ kind: "tool", name: "list_dir", inputJson: '{"path":"."}' },
			{ kind: "text", text: "TOOL_OK" },
		]);
	} finally {
		delete process.env.AGY_FAKE_TOOL_DIR;
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
