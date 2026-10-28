import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  AI_LOOP_SECONDS,
  AI_MODELS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  AI_QUALITIES,
  estimateAnimationUsd,
  findAiModel,
  normalizeAnimationSettings,
  type AiProviderInfo,
  type AiProviderStatus,
  type AiQuality,
  type AiState,
  type AnimationSettings,
  type SetKeyResult
} from '@shared/ai'

const QUALITY_LABELS: Record<AiQuality, string> = {
  draft: 'Draft',
  '720p': '720p',
  '1080p': '1080p'
}

/** Settings › AI & animation: provider keys and animation defaults. */
export default function AiSettings() {
  const [state, setState] = useState<AiState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    window.mirrorcat.ai
      .getState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setLoadFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (loadFailed) {
    return (
      <p className="settings-error" role="alert">
        Couldn’t load AI settings. Close Settings and try again.
      </p>
    )
  }
  if (!state) return <p className="settings-muted">Loading…</p>

  const setProvider = (status: AiProviderStatus): void =>
    setState(
      (s) => s && { ...s, providers: s.providers.map((p) => (p.id === status.id ? status : p)) }
    )

  const updateSettings = (patch: Partial<AnimationSettings>): void => {
    // Show the change at once; main's normalized answer wins when it lands.
    setState((s) => s && { ...s, settings: normalizeAnimationSettings(patch, s.settings) })
    window.mirrorcat.ai
      .updateSettings(patch)
      .then((settings) => setState((s) => s && { ...s, settings }))
      .catch(() => undefined)
  }

  const connected = new Set(state.providers.filter((p) => p.connected).map((p) => p.id))

  return (
    <div className="ai-settings">
      <div className="settings-intro">
        <h2 className="settings-title">AI &amp; animation</h2>
        <p className="settings-muted">
          Connect an AI provider so Cat can turn your images into seamless loops. You pay the
          provider directly; MirrorCat adds nothing on top.
        </p>
      </div>

      <section className="settings-section" aria-labelledby="ai-providers-h">
        <h3 id="ai-providers-h" className="settings-section-title">
          Providers
        </h3>
        {AI_PROVIDER_IDS.map((id) => {
          const status = state.providers.find((p) => p.id === id)
          return status ? (
            <ProviderCard
              key={id}
              info={AI_PROVIDERS[id]}
              status={status}
              secureStorage={state.secureStorage}
              recommended={id === 'luma'}
              onChange={setProvider}
            />
          ) : null
        })}
        <p className="settings-note">
          <LockIcon />
          <span>
            Keys are encrypted with your computer’s keychain and only ever sent to that provider.
            Once saved, a key is never shown again — replace it instead.
          </span>
        </p>
      </section>

      <AnimationDefaults
        settings={state.settings}
        connected={connected}
        onChange={updateSettings}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

interface ProviderCardProps {
  info: AiProviderInfo
  status: AiProviderStatus
  secureStorage: boolean
  recommended: boolean
  onChange: (status: AiProviderStatus) => void
}

function ProviderCard({ info, status, secureStorage, recommended, onChange }: ProviderCardProps) {
  const [editing, setEditing] = useState(!status.connected)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const baseId = useId()
  const inputId = `${baseId}-key`
  const errorId = `${baseId}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLButtonElement>(null)
  // Where focus should land after the control that had it goes away
  // (Save, Remove and Replace all swap the card's contents).
  const focusNext = useRef<'input' | 'replace' | null>(null)

  useEffect(() => {
    const target = focusNext.current === 'input' ? inputRef.current : replaceRef.current
    if (focusNext.current && target) target.focus()
    focusNext.current = null
  })

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.mirrorcat.ai.setKey(info.id, draft)
      if (result.ok) {
        setDraft('')
        setEditing(false)
        focusNext.current = 'replace'
        onChange(result.status)
      } else {
        setError(problemText(result.reason, info))
      }
    } catch {
      setError('Something went wrong saving the key. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const next = await window.mirrorcat.ai.removeKey(info.id)
    setDraft('')
    setError(null)
    setEditing(true)
    focusNext.current = 'input'
    onChange(next)
  }

  const cancelReplace = (): void => {
    setDraft('')
    setError(null)
    setEditing(false)
    focusNext.current = 'replace'
  }

  const showForm = editing || !status.connected

  return (
    <div className="provider-card" data-provider={info.id}>
      <div className="provider-head">
        <span className="provider-mark" aria-hidden="true">
          {info.name.charAt(0)}
        </span>
        <div className="provider-name">
          <span className="provider-title">
            {info.name}
            {recommended && <span className="provider-badge">Recommended</span>}
          </span>
          <span className="settings-muted">{info.tagline}</span>
        </div>
        <ProviderState status={status} />
      </div>

      {status.connected && !editing && (
        <div className="provider-row">
          <span className="settings-muted num provider-key-line">
            Key ending <span className="provider-last4">…{status.last4}</span> ·{' '}
            {status.check === 'ok'
              ? `checked ${relativeTime(status.checkedAt)}`
              : `saved — couldn’t reach ${info.name} to check it yet`}
          </span>
          <button
            ref={replaceRef}
            type="button"
            className="btn"
            onClick={() => {
              focusNext.current = 'input'
              setEditing(true)
            }}
          >
            Replace key
          </button>
          <button type="button" className="btn btn-ghost btn-danger" onClick={remove}>
            Remove
          </button>
        </div>
      )}

      {showForm && !secureStorage && (
        <p className="provider-row settings-error">
          This computer can’t store keys securely (no system keychain is available), so MirrorCat
          won’t save one.
        </p>
      )}

      {showForm && secureStorage && (
        <form className="provider-form" onSubmit={save}>
          <label htmlFor={inputId}>{info.name} API key</label>
          <div className="provider-form-row">
            <input
              ref={inputRef}
              id={inputId}
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.keyPlaceholder}
              value={draft}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value)
                if (error) setError(null)
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <button type="submit" className="btn btn-strong" disabled={busy || draft.trim() === ''}>
              {busy ? `Checking with ${info.name}…` : 'Save and check'}
            </button>
            {status.connected && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={cancelReplace}
                disabled={busy}
              >
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p id={errorId} className="settings-error" role="alert">
              {error}
            </p>
          )}
          <p className="settings-muted provider-help">
            No key yet?{' '}
            <a href={info.getKeyUrl} target="_blank" rel="noreferrer">
              Get one from {info.name} ↗
            </a>{' '}
            · Checking uses a free request, so nothing is charged.
          </p>
        </form>
      )}
    </div>
  )
}

function ProviderState({ status }: { status: AiProviderStatus }) {
  if (!status.connected) return <span className="provider-state settings-muted">Not connected</span>
  return (
    <span className="provider-state">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M5 8.2l2 2 4-4.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {status.check === 'ok' ? 'Connected' : 'Saved'}
    </span>
  )
}

function problemText(reason: Extract<SetKeyResult, { ok: false }>['reason'], info: AiProviderInfo) {
  switch (reason) {
    case 'empty':
      return 'Paste a key first.'
    case 'format':
    case 'too-long':
      return `That doesn’t look like a complete key. Copy it again from ${info.name}.`
    case 'rejected':
      return (
        `${info.name} didn’t accept that key. It may be incomplete, revoked or expired.` +
        (info.keyPrefix ? ` ${info.name} keys start with ${info.keyPrefix}` : '')
      )
    case 'insecure':
      return 'This computer can’t store keys securely, so MirrorCat won’t save it.'
  }
}

function relativeTime(at: number | null): string {
  if (at === null) return 'earlier'
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString()
}

// ---------------------------------------------------------------------------

interface AnimationDefaultsProps {
  settings: AnimationSettings
  connected: Set<string>
  onChange: (patch: Partial<AnimationSettings>) => void
}

function AnimationDefaults({ settings, connected, onChange }: AnimationDefaultsProps) {
  const baseId = useId()
  const model = findAiModel(settings.model)
  const estimate = estimateAnimationUsd(settings)
  const providerName = AI_PROVIDERS[model.provider].name
  return (
    <section className="settings-section" aria-labelledby={`${baseId}-h`}>
      <h3 id={`${baseId}-h`} className="settings-section-title">
        Animation defaults
      </h3>
      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-row-label">
            <label htmlFor={`${baseId}-model`}>Model</label>
            {!connected.has(model.provider) && (
              <span className="settings-muted">
                Connect {providerName} above to use this model.
              </span>
            )}
          </div>
          <select
            id={`${baseId}-model`}
            className="field settings-select"
            value={settings.model}
            onChange={(e) => onChange({ model: e.target.value as AnimationSettings['model'] })}
          >
            {AI_PROVIDER_IDS.map((pid) => (
              <optgroup key={pid} label={AI_PROVIDERS[pid].name}>
                {AI_MODELS.filter((m) => m.provider === pid).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.loop === 'native' ? ' (seamless loop)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <span className="settings-row-label" id={`${baseId}-len`}>
            Loop length
          </span>
          <div
            className="segmented segmented-lg"
            role="radiogroup"
            aria-labelledby={`${baseId}-len`}
          >
            {AI_LOOP_SECONDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={settings.loopSeconds === s}
                onClick={() => onChange({ loopSeconds: s })}
              >
                {s} s
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row-label" id={`${baseId}-q`}>
            Quality
          </span>
          <div className="segmented segmented-lg" role="radiogroup" aria-labelledby={`${baseId}-q`}>
            {AI_QUALITIES.map((q) => (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={settings.quality === q}
                onClick={() => onChange({ quality: q })}
              >
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <label htmlFor={`${baseId}-cap`}>Ask before spending more than</label>
            <span className="settings-muted num">
              {estimate !== null
                ? `Per animation. These settings cost about $${estimate.toFixed(2)} with ${providerName}.`
                : `Per animation. ${providerName} quotes a price for each one; you’ll see it before it starts.`}
            </span>
          </div>
          <MoneyField
            // Re-mounts when main's value changes (e.g. clamped), so the draft follows it.
            key={settings.askAboveUsd}
            id={`${baseId}-cap`}
            value={settings.askAboveUsd}
            onCommit={(askAboveUsd) => onChange({ askAboveUsd })}
          />
        </div>
      </div>
    </section>
  )
}

interface MoneyFieldProps {
  id: string
  value: number
  onCommit: (value: number) => void
}

/** A dollar amount, committed on blur or Enter; Escape or junk puts it back. */
function MoneyField({ id, value, onCommit }: MoneyFieldProps) {
  const [draft, setDraft] = useState(value.toFixed(2))

  const commit = (): void => {
    const parsed = Number(draft.replace(/[$,\s]/g, ''))
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(value.toFixed(2))
      return
    }
    if (parsed !== value) onCommit(parsed)
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      // Undo the edit only; Settings stays open (it skips handled keys).
      event.preventDefault()
      setDraft(value.toFixed(2))
    }
  }

  return (
    <div className="money-field">
      <span aria-hidden="true">$</span>
      <input
        id={id}
        className="num"
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
      />
    </div>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect
        x="3"
        y="7"
        width="10"
        height="7"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
