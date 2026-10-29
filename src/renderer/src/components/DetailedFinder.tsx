import { formatMegabytes, type SamStatus } from '@shared/sam'
import Tooltip from './Tooltip'

interface DetailedFinderProps {
  status: SamStatus | null
  /** Looking for more shapes right now. */
  busy: boolean
  /** What the last "find more" turned up, if anything. */
  result: string | null
  onFindMore: () => void
}

/**
 * The detailed finder (SAM 2): a one-time download, then "Find more
 * shapes" for curved, organic and low-contrast things the built-in finder
 * misses. Once it's here, boxes use it too.
 */
export default function DetailedFinder({ status, busy, result, onFindMore }: DetailedFinderProps) {
  if (!status) return null
  const size = formatMegabytes(status.totalBytes)

  return (
    <section className="finder-card" aria-label="Detailed finder">
      <h2 className="finder-title">Detailed finder</h2>
      {status.state === 'ready' ? (
        <>
          <p className="finder-text">
            Installed. Boxes you draw use it for exact outlines.
          </p>
          <Tooltip label="Look for curved and low-contrast shapes" keys={['F']}>
            <button type="button" className="btn btn-ghost finder-btn" onClick={onFindMore} disabled={busy}>
              {busy ? 'Looking closer…' : 'Find more shapes'}
            </button>
          </Tooltip>
          {busy && <p className="finder-text">Takes about 10 seconds.</p>}
          {!busy && result && (
            <p className="finder-text" role="status">
              {result}
            </p>
          )}
        </>
      ) : status.state === 'downloading' ? (
        <>
          <p className="finder-text">
            Downloading… {formatMegabytes(status.receivedBytes)} of {size}
          </p>
          <div
            className="finder-progress"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((status.receivedBytes / status.totalBytes) * 100)}
          >
            <span style={{ width: `${(status.receivedBytes / status.totalBytes) * 100}%` }} />
          </div>
          <button type="button" className="link-btn" onClick={() => void window.mirrorcat.capture.samCancel()}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="finder-text">
            Also finds curved, organic and low-contrast shapes, and makes boxes more exact. A one-time{' '}
            {size} download; it runs on this computer.
          </p>
          {status.state === 'failed' && (
            <p className="finder-text warn" role="alert">
              {status.message}
            </p>
          )}
          <button
            type="button"
            className="btn btn-ghost finder-btn"
            onClick={() => void window.mirrorcat.capture.samDownload()}
          >
            {status.state === 'failed' ? 'Try again' : `Download (${size})`}
          </button>
        </>
      )}
    </section>
  )
}
