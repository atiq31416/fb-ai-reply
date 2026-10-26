# FB Comment Reply Drafter

A Chrome extension that adds an **✨ AI reply** button and your saved snippets right under Facebook's comment and reply boxes. Replies are drafted with OpenRouter in the commenter's language. It never posts anything: it types into the box, and you press Enter yourself.

## Install (load unpacked)

1. Download the code (green **Code** button → **Download ZIP**, or clone it as below) and unzip it into a folder you will keep (Chrome loads it from there).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose that folder (the one containing `manifest.json`).
4. Pin the extension from the puzzle-piece menu so its icon stays in the toolbar.

Requires Chrome 116 or newer (it uses the side panel).

## Install from GitHub (recommended, easy updates)

1. Clone the repo with GitHub Desktop (**File → Clone repository**) or `git clone https://github.com/atiq31416/fb-ai-reply.git`.
2. In `chrome://extensions`, use **Load unpacked** on the cloned folder.

### Updating

Chrome does not auto-update unpacked extensions. When the side panel shows **"Version X is on GitHub"**:

1. Pull the latest code (GitHub Desktop: **Fetch origin → Pull**, or `git pull`).
2. Press **Reload** on the banner, or **Settings → Reload extension**. Your API key, settings and snippets are kept.

The panel checks GitHub for a newer `version` in `manifest.json` each time it opens. **Settings → Check for update** checks on demand. Bump `version` in `manifest.json` whenever you push a change so the notice appears.

## Set up

1. Click the extension icon. A side panel opens on the right.
2. Go to **Settings** and paste your OpenRouter API key (get one at https://openrouter.ai/keys).
3. Pick a model. The default `google/gemini-2.5-flash` is cheap and good at Bangla; `openai/gpt-4o-mini` or `anthropic/claude-haiku-4.5` also work. Type in the box to search all OpenRouter models.
4. Set your default tone, reply length (Auto by default: no limit, the reply fits the comment), and your Facebook name (so your own comments are skipped). Add any standing instructions, such as "invite people to DM for pricing".
5. Press **Save**, then **Test connection**.

The key and settings are stored only in this browser (`chrome.storage.local`).

## Use on Facebook (main way)

1. Open a Facebook post and click **Reply** under a comment (or click into any reply box). A small bar appears under the box.
2. Press **✨ AI reply** to draft a reply to that comment and type it into the box, or click a snippet chip to insert it. `{name}` becomes the commenter's first name.
3. Edit if you like and press Enter to post.

The bar also shows on the post's main "Write a comment" box, where snippets work but AI reply doesn't, since there is no comment to answer. **⚙** opens the side panel. You can turn the bar off in **Settings**. After installing or updating, refresh any Facebook tabs that were already open.

## Use the side panel (bulk drafting)

1. Open a Facebook post (its own page, or the post opened in the pop-up view).
2. In the side panel, press **Scan comments**. With "Load more comments and replies" on, it clicks "View more comments", "View N replies" and "See more" for you, then reads every comment.
3. Press **Draft all**, or **Draft** on a single comment. Replies come back in the comment's language: Bangla for Bangla, English for English, Banglish for Banglish.
4. Edit the draft if you like, then press **Fill reply**. The extension opens Facebook's reply box under that comment and types the draft in. Click into the box and press Enter to post it. **Copy** is still there as a fallback, and **Show on page** scrolls Facebook to the comment. Filled or copied comments fade so you can see what is left.

You can change the tone from the dropdown next to **Draft all** and press **Redo** on any comment.

## Snippets

The **Snippets** tab holds saved replies, such as "Thank you so much, {name}! 🙏". Picking a snippet from the **Snippet…** dropdown on a comment opens that comment's reply box on Facebook and fills it in. **Fill** on the Snippets tab types into the reply box that is already open (if none is open, it copies the snippet). `{name}` becomes the commenter's first name. You can add, edit and delete snippets; four examples are included.

## Tips and limits

- Facebook changes its page structure often. The scanner relies on accessibility labels and page structure instead of class names, so it should keep working, but if a scan finds nothing, scroll the comments into view and scan again.
- Facebook shows "Most relevant" comments by default and may hide some. Switch the post's comment filter to **All comments** before scanning to get everything.
- Comments that are only a sticker, photo or GIF are listed but can't be drafted by AI; use a snippet for those.
- Each draft is one OpenRouter request. Drafting runs three at a time.

## Files

- `manifest.json`: Manifest V3 config
- `background.js`: opens the side panel when the icon is clicked
- `sidepanel.html/.css/.js`: the UI, settings, snippets and OpenRouter calls
- `scanner.js`: the code injected into the Facebook tab to expand and read comments
