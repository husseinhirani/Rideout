import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "../src/env"

test("local env overrides .env without overriding exported variables", () => {
  const cwd = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), "rideout-env-"))
  const keys = ["RIDEOUT_ENV_TEST_LOCAL", "RIDEOUT_ENV_TEST_EXPORTED", "RIDEOUT_ENV_TEST_BASE"]
  const previous = keys.map(key => process.env[key])
  try {
    writeFileSync(join(dir, ".env"), "RIDEOUT_ENV_TEST_LOCAL=base\nRIDEOUT_ENV_TEST_BASE=base\n")
    writeFileSync(join(dir, ".env.local"), "RIDEOUT_ENV_TEST_LOCAL=local\nRIDEOUT_ENV_TEST_EXPORTED=file\n")
    process.env.RIDEOUT_ENV_TEST_EXPORTED = "shell"
    process.chdir(dir)
    loadEnv()
    assert.equal(process.env.RIDEOUT_ENV_TEST_LOCAL, "local")
    assert.equal(process.env.RIDEOUT_ENV_TEST_EXPORTED, "shell")
    assert.equal(process.env.RIDEOUT_ENV_TEST_BASE, "base")
  } finally {
    process.chdir(cwd)
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i] })
    rmSync(dir, { recursive: true, force: true })
  }
})
