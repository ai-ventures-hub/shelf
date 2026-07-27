/** Beat 05 — Capability Intelligence: a match receipt and a recorded gap. */
export function CapabilityAskAnswer() {
  return (
    <section id="capabilities" className="section" aria-labelledby="capabilities-heading">
      <div className="section-inner">
        <div className="section-head">
          <p className="eyebrow">Capability Intelligence</p>
          <h2 id="capabilities-heading">Agents ask. Shelf answers — or records the gap.</h2>
          <p className="section-lead">
            Tools declare what they can do and how agents may reach them. Matches come
            back scored and explainable. When nothing fits, the unmet need is written
            down — a plan, not a silent failure.
          </p>
        </div>
        <div className="cap-grid">
          <div className="cap-col">
            <p className="cap-ask">What can batch-optimize images?</p>
            <div className="cap-receipt" data-kind="match">
              <div className="cap-receipt-head">
                <strong>Image Prepper</strong>
                <span className="pill" data-tone="success">
                  Match
                </span>
              </div>
              <dl className="cap-receipt-rows">
                <div className="cap-receipt-row">
                  <dt>Declared capability</dt>
                  <dd data-mono="true">batch-optimize images</dd>
                </div>
                <div className="cap-receipt-row">
                  <dt>Agent access</dt>
                  <dd className="cap-ok">ready · CLI declared</dd>
                </div>
                <div className="cap-receipt-row">
                  <dt>How it matched</dt>
                  <dd>exact phrase — no embeddings, no proxy</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="cap-col">
            <p className="cap-ask">Can anything fill PDF forms?</p>
            <div className="cap-receipt" data-kind="gap">
              <div className="cap-receipt-head">
                <strong>Fill PDF forms</strong>
                <span className="pill" data-tone="warning">
                  Gap · open
                </span>
              </div>
              <dl className="cap-receipt-rows">
                <div className="cap-receipt-row">
                  <dt>Why</dt>
                  <dd>no tool declares this capability</dd>
                </div>
                <div className="cap-receipt-row">
                  <dt>Recorded</dt>
                  <dd data-mono="true">capability-gaps.json · deduped</dd>
                </div>
                <div className="cap-receipt-row">
                  <dt>Next action</dt>
                  <dd>
                    <span className="mock-btn mock-btn--primary" aria-hidden>
                      Create tool
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
