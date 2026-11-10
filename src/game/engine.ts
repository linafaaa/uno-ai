export type Color = 'red' | 'blue' | 'green' | 'yellow';

export type Card =
  | { id: string; color: Color; value: string }
  | { id: string; color: null; value: 'wild' | 'wild4' };

export type GameState = {
  players: Card[][];
  drawPile: Card[];
  discardPile: Card[];
  currentPlayer: number;
  currentColor: Color;
  direction: 1 | -1;
  winner: number | null;
  drawnCardId: string | null;
  unoCalled: boolean[];
  unoMissed: boolean[];
  events: string[];
};

const COLORS: Color[] = ['red', 'blue', 'green', 'yellow'];

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;

  for (const color of COLORS) {
    deck.push({ id: String(id++), color, value: '0' });

    for (let n = 1; n <= 9; n++) {
      deck.push({ id: String(id++), color, value: String(n) });
      deck.push({ id: String(id++), color, value: String(n) });
    }

    for (const action of ['skip', 'reverse', 'draw2']) {
      deck.push({ id: String(id++), color, value: action });
      deck.push({ id: String(id++), color, value: action });
    }
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ id: String(id++), color: null, value: 'wild' });
    deck.push({ id: String(id++), color: null, value: 'wild4' });
  }

  return shuffle(deck);
}

export function createGame(): GameState {
  const deck = createDeck();
  const players: Card[][] = [[], []];

  for (let i = 0; i < 7; i++) {
    players[0].push(deck.pop()!);
    players[1].push(deck.pop()!);
  }

  let firstCard = deck.pop()!;

  while (firstCard.color === null || !/^\d$/.test(firstCard.value)) {
    deck.unshift(firstCard);
    firstCard = deck.pop()!;
  }

  return {
    players,
    drawPile: deck,
    discardPile: [firstCard],
    currentPlayer: 0,
    currentColor: firstCard.color as Color,
    direction: 1,
    winner: null,
    drawnCardId: null,
    unoCalled: [false, false],
    unoMissed: [false, false],
    events: ['Game started'],
  };
}

export function getLegalMoves(
  state: GameState,
  playerIndex = state.currentPlayer
): Card[] {
  if (state.winner !== null || playerIndex !== state.currentPlayer) {
    return [];
  }

  const hand = state.players[playerIndex];
  const top = state.discardPile[state.discardPile.length - 1];

  return hand.filter((card) => {
    if (state.drawnCardId && card.id !== state.drawnCardId) {
      return false;
    }

    if (card.color === null) {
      if (card.value === 'wild4') {
        return !hand.some(
          (other) =>
            other.color === state.currentColor &&
            other.value !== 'wild' &&
            other.value !== 'wild4'
        );
      }
      return true;
    }

    return (
      card.color === state.currentColor ||
      card.value === top.value
    );
  });
}

function nextPlayer(state: GameState): number {
  return (state.currentPlayer + state.direction + 2) % 2;
}

function recycleDiscardPile(state: GameState): void {
  if (state.drawPile.length > 0 || state.discardPile.length <= 1) {
    return;
  }

  const top = state.discardPile.pop()!;
  state.drawPile = shuffle(state.discardPile);
  state.discardPile = [top];
}

function addEvent(state: GameState, message: string): void {
  state.events = [...state.events, message].slice(-100);
}

function cardLabel(card: Card): string {
  return card.color
    ? `${card.color.toUpperCase()} ${card.value.toUpperCase()}`
    : card.value === 'wild4' ? 'WILD DRAW 4' : 'WILD';
}

function handCounts(state: GameState): string {
  return `YOU: ${state.players[0].length} · BOT: ${state.players[1].length}`;
}

function drawCards(state: GameState, count: number, reason: string): void {
  const player = state.currentPlayer;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    recycleDiscardPile(state);
    const card = state.drawPile.pop();
    if (card) {
      state.players[player].push(card);
      drawn++;
    }
  }
  if (drawn > 0) {
    addEvent(state, `${player === 0 ? 'YOU' : 'BOT'} drew ${drawn} card(s) — ${reason}. ${handCounts(state)}`);
  }
}

export function drawCard(state: GameState): GameState {
  if (state.winner !== null || state.drawnCardId !== null) {
    return state;
  }

  const next = structuredClone(state) as GameState;
  recycleDiscardPile(next);

  const card = next.drawPile.pop();

  if (card) {
    next.players[next.currentPlayer].push(card);
    next.drawnCardId = card.id;
    addEvent(next, `${next.currentPlayer === 0 ? 'YOU' : 'BOT'} drew 1 card. ${handCounts(next)}`);
  } else {
    next.currentPlayer = nextPlayer(next);
  }

  return next;
}

export function passTurn(state: GameState): GameState {
  if (state.winner !== null) return state;

  const next = structuredClone(state) as GameState;

  if (next.drawnCardId === null) return next;

  next.drawnCardId = null;
  next.currentPlayer = nextPlayer(next);

  return next;
}

export function playCard(
  state: GameState,
  cardId: string,
  chosenColor?: Color
): GameState {
  if (state.winner !== null) return state;

  const legal = getLegalMoves(state);
  const card = legal.find((item) => item.id === cardId);

  if (!card) return state;

  if (card.color === null && !chosenColor) return state;

  const next = structuredClone(state) as GameState;
  const player = next.currentPlayer;
  const hand = next.players[player];
  const index = hand.findIndex((item) => item.id === cardId);

  const [played] = hand.splice(index, 1);
  next.discardPile.push(played);
  addEvent(next, `${player === 0 ? 'YOU' : 'BOT'} played ${cardLabel(played)}. ${handCounts(next)}`);

  if (hand.length === 1) {
    next.unoCalled[player] = player === 1;
    next.unoMissed[player] = false;
  }
  next.drawnCardId = null;

  if (hand.length === 0) {
    next.winner = player;
    return next;
  }

  if (played.color !== null) {
    next.currentColor = played.color;
  } else {
    next.currentColor = chosenColor!;
  }

  switch (played.value) {
    case 'skip':
    case 'reverse':
      next.currentPlayer = player;
      break;

    case 'draw2':
      next.currentPlayer = nextPlayer(next);
      drawCards(next, 2, 'DRAW 2 penalty');
      next.currentPlayer = player;
      break;

    case 'wild4':
      next.currentPlayer = nextPlayer(next);
      drawCards(next, 4, 'WILD DRAW 4 penalty');
      next.currentPlayer = player;
      break;

    default:
      next.currentPlayer = nextPlayer(next);
  }

  return next;
}


export function declareUno(state: GameState, playerIndex: number): GameState {
  if (
    state.winner !== null ||
    state.players[playerIndex]?.length !== 1 ||
    state.unoMissed[playerIndex]
  ) return state;

  const next = structuredClone(state) as GameState;
  next.unoCalled[playerIndex] = true;
  addEvent(next, `${playerIndex === 0 ? 'YOU' : 'BOT'} called UNO!`);
  return next;
}

export function catchUno(state: GameState, offender: number): GameState {
  if (
    state.winner !== null ||
    !state.unoMissed[offender] ||
    state.unoCalled[offender] ||
    state.players[offender]?.length !== 1
  ) return state;

  const next = structuredClone(state) as GameState;
  const activePlayer = next.currentPlayer;
  next.currentPlayer = offender;
  drawCards(next, 2, 'missed UNO penalty');
  next.currentPlayer = activePlayer;
  next.unoMissed[offender] = false;
  next.unoCalled[offender] = true;
  addEvent(next, `${offender === 0 ? 'YOU' : 'BOT'} was caught missing UNO. ${handCounts(next)}`);
  return next;
}
