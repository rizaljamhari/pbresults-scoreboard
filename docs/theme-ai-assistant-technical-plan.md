# Theme AI Assistant: Describe a Change, Review It, Apply It

Status: proposed · 2026-10-08

Building a theme today means many small edits across pieces, layers and settings. Plenty of them are easy to describe but slow to click through: "use Oswald everywhere", "match this poster's colours", "make the timer bigger and move it under the scores".

The **AI assistant** is a panel in the theme editor. The designer describes a change, optionally attaches a reference image, and the AI proposes edits to the draft. The designer sees a plain list of what will change, then applies or discards it. An applied change is one undo step. Nothing is saved or put on air until the designer saves and publishes, exactly as today.

It works with Claude, OpenAI, and free options: Google Gemini's free tier, OpenRouter's free models, and local models through Ollama. It's a pre-event tool. It never appears on Operations and nothing on air depends on it.

---

## 1. What the designer sees

- An **AI** button in the editor toolbar opens a side panel. If no provider is set up, the panel explains how and links to Settings.
- A text box for the request, plus:
  - **Attach image**: a reference such as a poster, a sponsor sheet or another broadcast's scorebug.
  - **Let the AI see the preview** (on by default): sends a capture of the editor canvas so the AI can judge its own work.
  - **Scope**: the whole theme (default) or only the selected piece. A narrow scope gives better results and costs less.
- After a few seconds the panel shows:
  - the AI's one-paragraph summary of what it did,
  - the change list from `diffThemes` ("Timer · font → Oswald", "Left panel · fill → #C8102E"),
  - **Apply** and **Discard**.
- **Apply** puts the change into the draft as one undo step (⌘Z reverts it). The canvas updates immediately.
- The designer can reply ("darker", "no, keep the logos") to continue the same thread. Each follow-up sends the current draft, so it includes any manual edits made in between.
- The thread is per editor session. It isn't stored, and closing the editor clears it.

If the AI's answer can't be used, the panel says so in plain words ("The AI's change didn't fit the theme format. Try again or rephrase.") and the draft is left untouched.

---

## 2. Providers

| Provider | Cost to the designer | Key / setup | Sees images | Notes |
|---|---|---|---|---|
| **Anthropic (Claude)** | Paid per use | API key from the Anthropic console | Yes | Expected best results on structured edits. Recommended default. |
| **OpenAI** | Paid per use | API key from the OpenAI platform | Yes | Similar quality on current GPT-5-series models. |
| **Google Gemini (free tier)** | Free, rate-limited | API key from Google AI Studio | Yes | Free tier covers Flash models only, enough for theme work. Free-tier requests may be used by Google to train its models, so Settings must say this plainly. |
| **OpenRouter (free models)** | Free, rate-limited | OpenRouter account and key | Some models | Around 50 free requests a day without credits. Which free models exist changes often, so the model is user-selectable. |
| **Ollama (local)** | Free, runs offline | Install Ollama and pull a vision model | Model-dependent | Fully private and works without internet. Needs a capable PC (GPU recommended), and quality on a 25 KB theme will be noticeably weaker. Treat as "best effort". |

Free-tier limits and model line-ups change without notice. The defaults live in one table in code (`src/server/ai/providers.ts`) and are checked again at release. The designer can always type a different model id.

Ollama needs a context window of at least 32k tokens, and its default is smaller. The adapter sets `num_ctx` on each request instead of relying on the user's Ollama settings.

---

## 3. How it works

```
Theme editor ──POST /api/ai/theme-edit──► server ──► provider adapter ──► Claude / OpenAI / Gemini / OpenRouter / Ollama
  (draft, request, images)                 │
                                           ├─ apply ops to a copy of the draft
                                           ├─ themeSchema.safeParse
                                           ├─ on failure: one retry with the errors
                                           └─ diffThemes ──► { summary, ops, changes } ──► editor shows review
```

- **All AI calls go through the server.** API keys never reach the browser, which matters once remote staff use the editor over ngrok.
- **The server never saves the theme.** It returns the ops and the change list. The editor applies the ops to its draft, so editing, undo, Save and Publish behave exactly as they do today.
- **One adapter per provider**, behind one interface:
  ```ts
  interface AiProvider {
    id: "anthropic" | "openai" | "gemini" | "openrouter" | "ollama";
    complete(input: { system: string; messages: AiMessage[]; images: AiImage[]; maxOutputTokens: number; signal: AbortSignal }): Promise<string>;
  }
  ```
  Each adapter calls the provider's HTTP API with `fetch`. That keeps the Windows build free of four SDKs, and OpenRouter and Ollama both accept the OpenAI request format, so they share most of one adapter.
- **Timeout:** 90 s, with Cancel in the panel. Errors are mapped to plain messages: bad key, rate limit reached ("Gemini's free limit is reached; try again in a minute"), offline, or the model can't read images.

### 3.1 What the AI receives

1. **System prompt:** its job, the edit format (§3.2), and the rules: never change ids, keep team names readable at 8 characters, prefer theme tokens and styles over one-off values, and say so instead of guessing when something isn't possible.
2. **Theme reference:** a compact description of the theme format, generated from the zod schemas in `src/shared/theme.ts` at build time, plus hand-written notes for fields whose meaning isn't obvious (content modes, follow targets, moments). Budget: 10k tokens or less. A raw JSON Schema dump would be several times larger.
3. **The current draft** without `versions` (18–32 KB for today's themes), or only the selected piece when the scope is narrowed.
4. **Images:** the attached reference and the canvas capture.
5. **The thread so far.**

Items 1 and 2 are identical on every request, so they go first, where Anthropic's prompt caching and OpenAI's automatic caching can reuse them.

### 3.2 Edit format

The AI returns one JSON object:

```json
{
  "summary": "Switched every text style to Oswald and moved the timer under the scores.",
  "ops": [
    { "op": "replace", "path": "/styles/text/@headline/fontFamily", "value": "Oswald" },
    { "op": "replace", "path": "/freeComponents/@timer-main/y", "value": 96 },
    { "op": "remove",  "path": "/freeComponents/@old-sponsor-strip" }
  ]
}
```

- The ops are a subset of JSON Patch: `add`, `replace` and `remove`.
- An `@id` segment picks an array item by its `id`, so the AI never deals with array positions and never has to rewrite the whole 14 KB `freeComponents` array.
- Small edits mean small, fast answers. That matters most for the free and local models, which tend to cut off or mangle long JSON.
- Providers with structured output (OpenAI `json_schema`, Gemini `responseSchema`, Claude tool use) are given the envelope schema `{ summary, ops[] }`. Ollama uses `format: "json"`. The theme itself is validated afterwards by zod, not by the provider, because the theme schema is too large and loose for strict structured-output modes.

### 3.3 Validation

`src/shared/themeOps.ts` (shared, so the editor and the server use the same code):

- `applyThemeOps(theme, ops)` → the new theme, or an error naming the op that failed (unknown id, bad path).
- The result must pass `themeSchema.safeParse`.
- Every id that existed before must still exist, unless an op removed it on purpose.
- On failure, the server sends the AI its own ops plus the errors and asks once for a fix. If the second answer also fails, the panel shows the error and the draft is untouched.

### 3.4 Preview capture

The editor captures its own canvas with `html-to-image` (or `modern-screenshot`) at half resolution, about 960×270 for a 1920 canvas. It's same-origin, so fonts and uploaded images render. Blend modes and backdrop blur may not capture faithfully, which is acceptable because the capture is for the AI's judgment, not for broadcast.

After the designer clicks **Apply**, the editor can optionally send a new capture with "Check your work" for a second pass. That's the visual loop that made AI useful in development. It's off by default because it doubles the cost.

---

## 4. Settings and keys

- A new **AI assistant** section in `/admin/settings`: choose a provider, paste a key (or the Ollama URL), pick a model, and **Test** (one tiny request).
- Several providers can be saved, with one active.
- Keys are stored by `src/server/ai/aiSecrets.ts`, modelled on `remoteAccessSecrets.ts`: a JSON file under the data directory, plain text in v1 by the same decision as the ngrok token, and in one place so it can be protected later.
- Keys are excluded from theme and state exports and from backups.
- **Remote staff can use the assistant but can't view or change keys.** Key management uses `isOnsiteManagementRequest`, the same gate as the remote-access settings.
- The settings page states what gets sent: the theme, the attached images and the canvas capture, which can include team names and logos from the live feed. For Gemini's free tier it also says Google may use the data for training.

---

## 5. Safety

- No publish, save or delete path. The AI only proposes ops, and the designer applies them to a draft.
- `/api/ai/*` is never called by the overlay or Operations, so a slow or failing provider can't affect the broadcast.
- Rate limit on our side: at most one request in flight per editor tab, and a cap of 20 requests a minute per server, to stop runaway retries spending someone's credit.
- The request body is limited to 8 MB, with images downscaled in the browser before upload.

---

## 6. Cost and limits

A typical whole-theme request: about 10k tokens of instructions and reference (cached after the first request), 8–10k tokens of theme, 2–3k tokens of images and 1–2k tokens of output. A selected-piece request is roughly half that.

- **Paid providers:** expect a few cents per request on a mid-tier vision model, and less with caching. The panel shows the token count of the last request so designers can see what they're spending. Exact prices are checked at release, not hard-coded.
- **Gemini free tier:** about 10 requests a minute on Flash. Enough for one designer, though a fast back-and-forth can hit it.
- **OpenRouter free:** 20 requests a minute and about 50 a day without credits, so one designing session can use the whole day's allowance.
- **Ollama:** no cost and no limits. Speed depends on the PC, and a whole-theme request can take minutes on a laptop without a GPU.

---

## 7. Phases

1. **Core and the two defaults.** `themeOps` and its tests, the theme reference generator, `/api/ai/theme-edit`, Anthropic and Gemini adapters, key storage and Settings, and a text-only editor panel with review, Apply and undo. Gemini ships first alongside Claude so the free path is tested from the start.
2. **Images.** Reference image upload, canvas capture, and the optional "check your work" pass.
3. **More providers.** OpenAI, OpenRouter and Ollama, sharing the OpenAI-format adapter, plus per-provider error messages and the model picker.
4. **Polish.** Selected-piece scope, starter prompts ("Make a theme from this poster", "Check readability"), and the token count display.

Each phase ships on its own. After phase 1 the assistant is already usable for text requests.

## 8. Tests

- `themeOps`: each op kind, `@id` resolution, unknown ids, removing a missing path, and protection of ids against accidental loss.
- The reference generator stays within its token budget and covers every component id. It fails the build if a new schema field has no description.
- Each adapter against recorded provider responses, covering success, bad key, rate limit, cut-off JSON and timeout.
- The route: validation failure → one retry → error; the remote request is refused key access.
- Editor: Apply is a single undo step, and Discard leaves the draft unchanged.

## 9. Open questions

1. **Default provider for new installs.** Recommendation: none selected. Settings explains the choice, with Gemini's free tier as the easiest start and Claude as the best results.
2. **Ollama quality.** It needs a real trial on a mid-range Windows laptop with a current vision model before we promise anything beyond "experimental".
3. **Capture fidelity.** Check `html-to-image` against a theme that uses blend modes and backdrop blur. If it's poor, fall back to sending only the reference image.
4. **Release timing.** Phase 1 is roughly a week of work. Decide whether public release waits for it or ships first with the assistant following shortly after.
