/**
 * What a deterministic extraction found — counts, contributing files, and
 * what was deliberately left out. Shared by the Import dialog and the
 * new-profile wizard so both report identically.
 */
import type { ExtractedTokens } from '../../types'

export function extractionTotal(result: ExtractedTokens): number {
  return (
    result.counts.color +
    result.counts.typography +
    result.counts.dimension +
    result.counts.light +
    result.counts.dark
  )
}

export function ExtractionSummary({ result }: { result: ExtractedTokens }) {
  const overrideCount = result.counts.light + result.counts.dark

  return (
    <div className="stack" style={{ gap: '.6rem' }}>
      <p style={{ margin: 0 }}>
        {extractionTotal(result) === 0 ? (
          <>No literal design tokens found in this project.</>
        ) : (
          <>
            Found <strong>{result.counts.color}</strong> colors,{' '}
            <strong>{result.counts.typography}</strong> typography and{' '}
            <strong>{result.counts.dimension}</strong> dimension tokens
            {overrideCount > 0 ? (
              <>
                {' '}
                plus <strong>{overrideCount}</strong> light/dark overrides
              </>
            ) : null}
            .
          </>
        )}
      </p>
      {result.sources.length > 0 ? (
        <ul className="import-tokens-files">
          {result.sources.map((source) => (
            <li key={source.file}>
              <code>{source.file}</code> — {source.declarations} declaration
              {source.declarations === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
      ) : null}
      {result.skipped.length > 0 ? (
        <details>
          <summary className="field-hint" style={{ cursor: 'pointer' }}>
            Not extracted ({result.skipped.length})
          </summary>
          <ul className="import-tokens-files">
            {result.skipped.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
