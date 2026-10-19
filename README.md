# OpenAttach

A blue **+** button for [OpenCode](https://opencode.ai)'s terminal UI on Android — tap it, pick photos or files from your phone, and send them to your chat, just like the ChatGPT app.

> 📸 **Screenshot:** coming soon — it's a small blue `+` at the right side of the footer, under the model name.

## What it does

- Tap **+** → the Android file picker opens (photos, documents — anything your phone can share)
- Pick as many files as you need: after each pick, choose **Send now** or **Add another file**
- Type your message → the message and every file arrive together in your chat
- Works from the home screen too: **+** starts a new chat for you, like the apps do

This version is for phones (Android + Termux). A computer version may come later.

## Requirements

- An Android phone with [Termux](https://termux.dev)
- OpenCode v2 running in the Termux terminal (the TUI) — tested on 2.0.21
- The **Termux:API** app (from F-Droid) **and** the `termux-api` package inside Termux:

  ```sh
  pkg install termux-api
  ```

## Install (one line)

Add the `plugins` line to your existing OpenCode config at `~/.config/opencode/opencode.json` (keep any other settings you already have):

```json
{
  "plugins": ["openattach@git+https://github.com/insetrobin-dotcom/OpenAttach.git"]
}
```

Then restart the TUI. The first start downloads the plugin (up to a minute on a phone — if the `+` does not appear yet, restart once more). You will see a blue **+** at the right side of the footer, under the model name.

<details>
<summary>Alternative: <code>cli.json</code> route</summary>

The same line also works in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["openattach@git+https://github.com/insetrobin-dotcom/OpenAttach.git"]
}
```

</details>

## Use

- **Tap** the blue `+`
- Or press **`ctrl+x`** then **`f`**
- Or open the command palette (**`ctrl+p`**) and pick **Upload image or file**

After each picked file, a small dialog asks:

- **Send now** — go straight to writing your message
- **Add another file** — open the picker again

When you are done, type your message (or leave it empty) and press **Enter**. The files go with it.

## Troubleshooting

| What you see | Fix |
| --- | --- |
| "Uploads need the Termux:API app" toast | Install the Termux:API app from F-Droid |
| "Uploads need termux-api" toast | Run `pkg install termux-api` inside Termux |
| You cancelled the picker / nothing happened | Nothing is sent — just tap `+` again (a cancelled pick ends silently after about 15 seconds) |
| Very large files take a while | The picker copies the file first; wait for the "file ready" dialog |

Uploaded files are kept in `~/.cache/opencode-uploads`. Chat messages point to these files, so do not delete that folder — old chats would lose their attachments.

## Making a video?

A quick demo that shows everything in about 30 seconds:

1. Show the TUI and point at the `+` next to the model name.
2. Tap `+` → pick a photo → **Add another file** → pick a second one.
3. **Send now** → type "what's in these photos?" → press Enter.
4. Show the message arriving with both attachments.
5. Bonus: mention `ctrl+x f` for keyboard fans, and show the one-line install.

## License

MIT — see [LICENSE](LICENSE). Made by InsetRobin.
