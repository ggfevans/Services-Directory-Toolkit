import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/probe-tokens.js", import.meta.url));

// Runs the probe with the given settings. Every case here exits before the probe sends a request.
const probe = (settings) => spawnSync(process.execPath, [SCRIPT], {
  env: { PATH: process.env.PATH, ...settings },
  encoding: "utf8"
});

test("the token probe refuses to run without a server and a secured service", () => {
  const result = probe({});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROBE_BASE and PROBE_SECURED are required/);
});

test("the token probe asks for a password or a manual sign-in", () => {
  const result = probe({ PROBE_BASE: "https://gis.example.org/server", PROBE_SECURED: "Folder/Service/MapServer" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROBE_MANUAL_LOGIN=1/);
});
