import { currentAdvice, type Game } from '../game';
import { DECISION_LABELS } from '../accuracy';
import { situation, type Feedback } from '../coaching';
import { Dialog } from './Tracker';

export function Hint({ game, close }: { game: Game; close: () => void }) {
  const advice = currentAdvice(game);
  if (!advice) return null;
  return (
    <Dialog title="Your next move" close={close}>
      <p className="dialog-intro">{situation(game)}</p>
      <section className="coach-answer" aria-label="Strategy hint">
        <span className="eyeline">Basic strategy recommends</span>
        <h3>{advice.name}</h3>
        <p>{advice.reason}</p>
      </section>
      <p className="setting-note">
        Based on your hand, the dealer’s upcard, and the actions you can take. The next card is
        unknown.
      </p>
      <button className="primary" onClick={close}>
        Back to my hand
      </button>
    </Dialog>
  );
}

export function FeedbackDetails({ feedback, close }: { feedback: Feedback; close: () => void }) {
  return (
    <Dialog title="Your last choice" close={close}>
      <p className="dialog-intro">{feedback.situation} · before your choice</p>
      <section className="coach-answer" aria-label="Decision explanation">
        <span className="eyeline">
          {feedback.correct ? 'Follows basic strategy' : 'A better play was available'}
        </span>
        <h3>You chose {DECISION_LABELS[feedback.chosen]}</h3>
        <p>
          <b>Recommended: {DECISION_LABELS[feedback.expected]}.</b> {feedback.reason}
        </p>
      </section>
      <p className="setting-note">
        This reviews your choice, regardless of whether the hand wins or loses.
      </p>
      <button className="primary" onClick={close}>
        Back to the table
      </button>
    </Dialog>
  );
}
