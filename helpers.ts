import { statSync } from "node:fs"

// termux-storage-get gives no filename, so we sniff the file type from its first bytes.
// shortcut: all text files become .txt (a picked .md/.sh loses its label); add a name-hint map if it ever bites.
export function extFor(bytes: Uint8Array): string {
  const starts = (sig: number[], at = 0) => sig.every((v, i) => bytes[at + i] === v)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ".png"
  if (starts([0xff, 0xd8, 0xff])) return ".jpg"
  if (starts([0x47, 0x49, 0x46, 0x38])) return ".gif"
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return ".webp"
  if (starts([0x25, 0x50, 0x44, 0x46])) return ".pdf"
  const head = bytes.subarray(0, 4096)
  if (head.length > 0 && !head.includes(0)) {
    if (!new TextDecoder("utf-8").decode(head).includes("\uFFFD")) return ".txt"
  }
  return ".bin"
}

// termux-storage-get exits long before the picker finishes copying the file (it even
// exits 0 when the picker is cancelled). Wait until the file appears and its size
// stops changing; resolves false when isDead() reports the attempt was superseded.
export function waitForStableFile(path: string, isDead: () => boolean, pollMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let lastSize = -1
    const timer = setInterval(() => {
      if (isDead()) {
        clearInterval(timer)
        resolve(false)
        return
      }
      let size = -1
      try {
        size = statSync(path).size
      } catch {}
      if (size > 0 && size === lastSize) {
        clearInterval(timer)
        resolve(true)
        return
      }
      lastSize = size
    }, pollMs)
  })
}
