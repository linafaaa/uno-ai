import type { Card, Color } from './engine';
import type { ApiGameState } from './api';
import { parseRlCard } from './api';

const COLOR_PREFIX: Record<string, Color> = {
  r: 'red',
  g: 'green',
  b: 'blue',
  y: 'yellow',
};

export type ApiGameView = {
  hand: Card[];
  opponentCardCount: number;
  topCard: Card;
  currentColor: Color;
  discardCount: number;
  winner: 0 | 1 | null;
  events: string[];
};

export function toApiGameView(state: ApiGameState): ApiGameView {
  const prefix = state.target.split('-')[0];
  const currentColor = COLOR_PREFIX[prefix];

  if (!currentColor) {
    throw new Error(`Unknown RLCard target color: ${state.target}`);
  }

  const hand = state.your_hand.map((raw, index) =>
    parseRlCard(raw, index),
  );

  const topCard = parseRlCard(
    state.target,
    state.played_cards.length - 1,
    true,
  );

  const winner: 0 | 1 | null =
    state.status !== 'finished'
      ? null
      : state.result?.you_won
        ? 0
        : 1;

  return {
    hand,
    opponentCardCount: state.num_cards[1] ?? 0,
    topCard,
    currentColor,
    discardCount: state.played_cards.length,
    winner,
    events: state.events ?? [],
  };
}
