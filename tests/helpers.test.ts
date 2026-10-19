import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extFor, waitForStableFile } from "../helpers.ts"

test("detects png", () => {
  assert.equal(extFor(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])), ".png")
})

test("detects jpeg", () => {
  assert.equal(extFor(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), ".jpg")
})

test("detects gif", () => {
  assert.equal(extFor(Buffer.from("GIF89a......")), ".gif")
})

test("detects webp", () => {
  const b = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from([0])])
  assert.equal(extFor(b), ".webp")
})

test("detects pdf", () => {
  assert.equal(extFor(Buffer.from("%PDF-1.4 hello")), ".pdf")
})

test("detects plain text", () => {
  assert.equal(extFor(Buffer.from("hello, this is a note\nsecond line")), ".txt")
})

test("binary junk without known magic is .bin", () => {
  assert.equal(extFor(Buffer.from([0, 255, 0, 1, 2, 3])), ".bin")
})

test("empty input is .bin", () => {
  assert.equal(extFor(Buffer.from([])), ".bin")
})

test("waitForStableFile resolves true for an already-settled file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ocw-"))
  const p = join(dir, "f")
  writeFileSync(p, "hello")
  assert.equal(await waitForStableFile(p, () => false, 25), true)
  rmSync(dir, { recursive: true, force: true })
})

test("waitForStableFile resolves true when the file appears late", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ocw-"))
  const p = join(dir, "f")
  setTimeout(() => writeFileSync(p, "late"), 60)
  assert.equal(await waitForStableFile(p, () => false, 25), true)
  rmSync(dir, { recursive: true, force: true })
})

test("waitForStableFile gives up when the attempt is superseded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ocw-"))
  const p = join(dir, "f")
  let dead = false
  setTimeout(() => (dead = true), 60)
  assert.equal(await waitForStableFile(p, () => dead, 25), false)
  rmSync(dir, { recursive: true, force: true })
})
