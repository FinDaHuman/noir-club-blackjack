import { accuracySummary, DECISION_LABELS } from '../accuracy';
import { canBet, type Game } from '../game';

function rate(correct: number, total: number) {
  return total ? `${Number(((correct / total) * 100).toFixed(1))}%` : '—';
}
export function AccuracyStats({ game }: { game: Game }) {
  const s = game.stats;
  const reviews = game.history.filter((r) => r.accuracy?.decisions.some((d) => !d.correct));
  return (
    <section className="accuracy-stats" aria-labelledby="accuracy-title">
      <div className="accuracy-heading">
        <h3 id="accuracy-title">Basic-strategy accuracy</h3>
        <span>Completed rounds</span>
      </div>
      <div className="accuracy-metrics">
        <div>
          <span>Correctly played hands</span>
          <strong className="accuracy-hand-rate">
            {rate(s.strategyCorrectHands, s.strategyHands)}
          </strong>
          <small className="accuracy-hand-count">
            {s.strategyCorrectHands} of {s.strategyHands} graded hands
          </small>
        </div>
        <div>
          <span>Decision accuracy</span>
          <strong className="accuracy-decision-rate">
            {rate(s.strategyCorrectDecisions, s.strategyDecisions)}
          </strong>
          <small className="accuracy-decision-count">
            {s.strategyCorrectDecisions} of {s.strategyDecisions} decisions correct
          </small>
        </div>
      </div>
      {!canBet(game) && (
        <p className="accuracy-pending">This round will be added when it finishes.</p>
      )}
      <details className="accuracy-method">
        <summary>How accuracy is measured</summary>
        <div>
          <p>
            A hand is correct only when every recorded choice follows this table’s six-deck,
            stand-on-17 basic strategy. Recommendations use the visible upcard and the actions you
            could afford and legally take at that moment. Wins and losses do not affect the score.
          </p>
          <p>
            Split hands are graded separately. Insurance and the original split choice apply to both
            resulting hands, but each choice counts only once in decision accuracy. Hands with no
            recorded choice and insurance prompts where you cannot afford insurance are not graded.
          </p>
          <p>
            Tracking starts with newly dealt hands. Older history and rounds already in progress
            when tracking was added are ungraded. Totals cover the session; detailed reviews retain
            the last 100 completed rounds. Reset session also resets accuracy.
          </p>
        </div>
      </details>
      <div className="accuracy-heading review-heading">
        <h3>Mistake review</h3>
        <span>Last 100 completed rounds</span>
      </div>
      {reviews.length ? (
        <div className="accuracy-reviews">
          {reviews.map((round) => {
            const accuracy = round.accuracy!;
            const mistakes = accuracy.decisions.filter((d) => !d.correct);
            const summary = accuracySummary(accuracy);
            return (
              <details className="accuracy-review" key={round.id}>
                <summary>
                  <span>Round #{round.id}</span>
                  <span>
                    {mistakes.length} {mistakes.length === 1 ? 'mistake' : 'mistakes'}{' '}
                    <small>
                      · {summary.correctDecisions}/{summary.decisions} correct
                    </small>
                  </span>
                </summary>
                <div className="accuracy-review-body">
                  <p className="hand-grades">
                    {accuracy.hands
                      .map(
                        (h, i) =>
                          `Hand ${i + 1}: ${h.correct === null ? 'no decision' : h.correct ? 'correct' : 'needs review'}`,
                      )
                      .join(' · ')}
                  </p>
                  <ol className="decision-review-list">
                    {mistakes.map((d) => (
                      <li key={d.id} value={d.id}>
                        <div className="decision-context">
                          <b>
                            {d.source === 'insurance'
                              ? 'Insurance'
                              : d.source === 'split'
                                ? `Hand ${d.hand}`
                                : 'Original hand'}
                          </b>
                          <span>Dealer shows {d.upcard}</span>
                        </div>
                        <p className="decision-cards">
                          {d.cards.join(' ')}{' '}
                          <span>
                            · {d.soft ? 'Soft' : 'Hard'} {d.total}
                          </span>
                        </p>
                        <dl className="decision-comparison">
                          <div>
                            <dt>You chose</dt>
                            <dd>{DECISION_LABELS[d.chosen]}</dd>
                          </div>
                          <div>
                            <dt>Basic strategy</dt>
                            <dd>{DECISION_LABELS[d.expected]}</dd>
                          </div>
                        </dl>
                        <p className="decision-explanation">{d.explanation}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="accuracy-empty">
          {s.strategyDecisions
            ? 'No mistakes in your retained, tracked rounds.'
            : 'No graded decisions yet. Complete a new hand to start tracking.'}
        </p>
      )}
    </section>
  );
}
