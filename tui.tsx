import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { extFor, waitForStableFile } from "./helpers.ts"

// Picked files live here and stay on disk: session messages reference the path.
const CACHE = join(homedir(), ".cache", "opencode-uploads")

// OC_UPLOAD_PICKER overrides the picker binary (used by tests with a stub).
function runPicker(dst: string) {
  const cmd = process.env.OC_UPLOAD_PICKER ?? "termux-storage-get"
  return new Promise<number>((resolve) => {
    const child = spawn(cmd, [dst], { stdio: "ignore" })
    // shortcut: a hung picker (e.g. a dead Termux:API receiver) would otherwise hang forever; kill after 10 min.
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000)
    child.on("error", () => {
      clearTimeout(timer)
      resolve(-1)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code ?? -1)
    })
  })
}

// termux-storage-get hangs forever when the Termux:API app is missing (no android picker appears),
// so check the app is installed first and fail with a toast instead of doing nothing.
function apiAppInstalled() {
  return new Promise<boolean>((resolve) => {
    const child = spawn("pm", ["path", "com.termux.api"], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 5000)
    child.stdout?.on("data", (d) => (out += String(d)))
    child.on("error", () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 && out.includes("package:"))
    })
  })
}

export default Plugin.define({
  id: "openattach",
  setup(context) {
    // Each + press is an attempt; a newer attempt supersedes older ones (e.g. tapping +
    // again after cancelling the Android picker). "sending" guards the dialog step.
    let attemptSeq = 0
    let sending = false
    const uploadInner = async () => {
      if (sending) return
      const attempt = ++attemptSeq
      if (!process.env.OC_UPLOAD_PICKER && !(await apiAppInstalled())) {
        context.ui.toast.show({
          message: "Uploads need the Termux:API app — install it from F-Droid, then try again",
          variant: "error",
          duration: 10000,
        })
        return
      }
      if (attempt !== attemptSeq) return
      const current = context.ui.router.current()
      let sessionID = current?.type === "session" ? current.sessionID : undefined
      mkdirSync(CACHE, { recursive: true })
      const tmp = join(CACHE, `upload-${Date.now()}`)
      const code = await runPicker(tmp)
      if (code === -1 && !existsSync(tmp)) {
        context.ui.toast.show({
          message: "Uploads need termux-api — run: pkg install termux-api",
          variant: "error",
          duration: 10000,
        })
        return
      }
      // termux-storage-get exits before the picker finishes copying the file (exit code
      // says nothing about a pick), so wait for the file to appear and settle. A cancelled
      // pick ends silently; the attempt just stays open until the next + supersedes it.
      const got = await waitForStableFile(tmp, () => attempt !== attemptSeq)
      if (attempt !== attemptSeq) {
        if (existsSync(tmp)) rmSync(tmp)
        return
      }
      if (!got || !existsSync(tmp)) {
        context.ui.toast.show({ message: "Upload failed: file did not arrive", variant: "error" })
        return
      }
      const file = tmp + extFor(readFileSync(tmp))
      renameSync(tmp, file)
      const name = basename(file)
      sending = true
      try {
        const text = await context.ui.dialog.prompt({
          title: "Send to chat",
          message: `${name} is attached — type a message, then press Enter`,
          placeholder: "Type your message…",
        })
        if (text === null || text === undefined) {
          rmSync(file)
          context.ui.toast.show({ message: "Upload cancelled", variant: "info" })
          return
        }
        if (!sessionID) {
          // + on the home screen: start a chat first, like the ChatGPT app does.
          try {
            const created = await context.client.session.create({
              location: context.location ?? context.data.location.default(),
            })
            sessionID = created?.id ?? created?.data?.id
            if (sessionID) context.ui.router.navigate({ type: "session", sessionID })
          } catch (e) {
            context.ui.toast.show({
              message: `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
              variant: "error",
            })
            return
          }
          if (!sessionID) {
            context.ui.toast.show({ message: "Upload failed: could not start a chat", variant: "error" })
            return
          }
        }
        try {
          await context.client.session.prompt({ sessionID, text, files: [{ uri: "file://" + file, name }] })
        } catch (e) {
          context.ui.toast.show({
            message: `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
            variant: "error",
          })
          return
        }
        context.ui.toast.show({ message: `Sent ${name}`, variant: "success" })
      } finally {
        sending = false
      }
    }

    // v2.0.21: keymap.layer() throws "Keymap.Provider is missing" when called from setup,
    // so the layer is registered from the slot render. It must be re-created on every
    // render: Solid disposes the previous computation (and with it the layer) on re-render.
    context.ui.slot({
      append: "prompt.footer",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          priority: 10,
          commands: [
            {
              id: "openattach",
              title: "Upload image or file",
              group: "Prompt",
              bind: "<leader>f",
              palette: true,
              slash: { name: "upload" },
              run: () => void uploadInner(),
            },
          ],
          bindings: ["openattach"],
        }))
        return (
          <text onMouseDown={() => void uploadInner()} fg="#7aa2f7">
            {" + "}
          </text>
        )
      },
    })
  },
})
