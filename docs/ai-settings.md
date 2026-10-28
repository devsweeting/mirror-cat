# Settings › AI & animation

Where you connect an AI provider and set animation defaults. Opened from
the gear in the top bar or **⌘,** (app menu ▸ Settings…; File ▸ Settings,
Ctrl+, on Windows/Linux). A modal over the editor
(`components/settings/SettingsPanel.tsx`), one section so far.

## Keys

| Piece | Where | What it does |
| --- | --- | --- |
| `KeyStore` | `main/ai/keyStore.ts` | Keys encrypted with safeStorage in `userData/ai-keys.json` (base64 ciphertext + last four + check state). Refuses to store anything when encryption isn't available, including Linux's `basic_text` fallback. |
| `checkProviderKey` | `main/ai/keyCheck.ts` | A free request per provider before saving. 401/403 → rejected; 5xx, network error or 10 s timeout → unreachable; anything else → ok. |
| AI IPC | `main/ipc/aiHandlers.ts` | `ai:get-state`, `ai:set-key`, `ai:remove-key`, `ai:update-settings`. Control window only. |

Rules:

- A key goes **in** once (`ai:set-key`) and never comes back out. Every
  reply is an `AiProviderStatus`: connected, last four, checked or not.
  `KeyStore.getKey()` is main-only, for the provider calls that come with
  generation.
- Input is trimmed and sanity-checked (`validateKeyInput`: 8–512 chars, no
  inner whitespace or control characters) before any network call.
- Rejected keys are not stored. If the provider can't be reached, the key
  **is** stored, marked `unchecked`, and the card says so — no re-pasting
  later.

Free key checks:

- **Luma (Agents API)**: `GET https://agents.lumalabs.ai/v1/generations/<nil uuid>`
  with `Bearer`. There's no "who am I" endpoint; a good key gets 404, a
  bad / revoked / expired one 401. *Assumption until tested with a real
  key.*
- **fal.ai**: `GET https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev`
  with `Key`. Needs no permissions beyond a valid key.

## Animation defaults

`AnimationSettings` (`shared/ai.ts`), in `userData/ai-settings.json` via
`AiSettingsStore`: model, loop length (5/10 s), quality (draft/720p/1080p),
and "ask before spending more than" (USD, 0–100, cents). Every update from
the renderer goes through `normalizeAnimationSettings`.

The estimate under the spend field uses published prices where they're
fixed (Luma Ray 3.2 pay-as-you-go, Oct 2026: 5 s at $0.06 / $0.30 / $1.20,
10 s at $0.18 / $0.90 / $3.60). fal.ai models are quoted per request; the
pricing API gets wired up with generation.

## Test hooks (development builds only)

- `MIRRORCAT_AI_FAKE_CRYPTO=1`: reversible stand-in instead of the Keychain.
- `MIRRORCAT_AI_KEYCHECK=accept|reject|offline`: canned key-check answers.

Used by `e2e/settings.spec.ts`. A packaged app ignores both.
