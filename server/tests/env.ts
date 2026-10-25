import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "../src/env"

test("local env overrides .env without overriding exported variables", () => {
  const cwd = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), "sealert-env-"))
  const keys = ["SEALERT_ENV_TEST_LOCAL", "SEALERT_ENV_TEST_EXPORTED", "SEALERT_ENV_TEST_BASE"]
  const previous = keys.map(key => process.env[key])
  try {
    writeFileSync(join(dir, ".env"), "SEALERT_ENV_TEST_LOCAL=base\nSEALERT_ENV_TEST_BASE=base\n")
    writeFileSync(join(dir, ".env.local"), "SEALERT_ENV_TEST_LOCAL=local\nSEALERT_ENV_TEST_EXPORTED=file\n")
    process.env.SEALERT_ENV_TEST_EXPORTED = "shell"
    process.chdir(dir)
    loadEnv()
    assert.equal(process.env.SEALERT_ENV_TEST_LOCAL, "local")
    assert.equal(process.env.SEALERT_ENV_TEST_EXPORTED, "shell")
    assert.equal(process.env.SEALERT_ENV_TEST_BASE, "base")
  } finally {
    process.chdir(cwd)
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i] })
    rmSync(dir, { recursive: true, force: true })
  }
})
