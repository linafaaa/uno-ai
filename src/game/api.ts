import type { Card, Color } from './engine';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

export type ApiLegalAction = {
  action_id: number;
  action: string;
};

export type ApiAiDecision = {
  action_id: number;
  action: string;
  q_value: number;
  legal_action_values: {
    action_id: number;
    action: string;
    q_value: number;
  }[];
};

export type ApiGameState = {
  game_id: string;
  status: 'playing' | 'finished';
  current_player: number;
  your_hand: string[];
  target: string;
  played_cards: string[];
  num_cards: number[];
  legal_actions: ApiLegalAction[];
  last_ai_decision: ApiAiDecision | null;
  ai_history: ApiAiDecision[];
  events: string[];
  uno_pending: boolean;
  result: {
    payoffs: number[];
    you_won: boolean;
  } | null;
};

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `API error ${response.status}`;

    try {
      const body = await response.json();
      if (body.detail) {
        message = String(body.detail);
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function createApiGame(): Promise<ApiGameState> {
  return request<ApiGameState>('/game/new', {
    method: 'POST',
  });
}

export function getApiGame(gameId: string): Promise<ApiGameState> {
  return request<ApiGameState>(
    `/game/${encodeURIComponent(gameId)}`,
  );
}

export function submitApiAction(
  gameId: string,
  actionId: number,
): Promise<ApiGameState> {
  return request<ApiGameState>(
    `/game/${encodeURIComponent(gameId)}/action`,
    {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId }),
    },
  );
}

export function declareApiUno(gameId: string): Promise<ApiGameState> {
  return request<ApiGameState>(
    `/game/${encodeURIComponent(gameId)}/uno/declare`,
    { method: 'POST' },
  );
}

export function acceptUnoPenalty(gameId: string): Promise<ApiGameState> {
  return request<ApiGameState>(
    `/game/${encodeURIComponent(gameId)}/uno/penalty`,
    { method: 'POST' },
  );
}

const COLOR_PREFIX: Record<string, Color> = {
  r: 'red',
  g: 'green',
  b: 'blue',
  y: 'yellow',
};

const COLOR_CODE: Record<Color, string> = {
  red: 'r',
  green: 'g',
  blue: 'b',
  yellow: 'y',
};

function toRlTrait(value: string): string {
  if (value === 'draw2') return 'draw_2';
  if (value === 'wild4') return 'wild_draw_4';
  return value;
}

export function parseRlCard(
  raw: string,
  index: number,
  wildAsColored = false,
): Card {
  const separator = raw.indexOf('-');

  if (separator < 1) {
    throw new Error(`Unknown RLCard card format: ${raw}`);
  }

  const prefix = raw.slice(0, separator);
  const trait = raw.slice(separator + 1);
  const color = COLOR_PREFIX[prefix];

  if (!color) {
    throw new Error(`Unknown RLCard color: ${raw}`);
  }

  const id = `${raw}:${index}`;

  if (trait === 'wild') {
    return {
      id,
      color: wildAsColored ? color : null,
      value: 'wild',
    };
  }

  if (trait === 'wild_draw_4') {
    return {
      id,
      color: wildAsColored ? color : null,
      value: 'wild4',
    };
  }

  return {
    id,
    color,
    value: trait === 'draw_2' ? 'draw2' : trait,
  };
}

export function getLegalActionsForCard(
  card: Card,
  legalActions: ApiLegalAction[],
): ApiLegalAction[] {
  if (card.color === null) {
    const suffix =
      card.value === 'wild' ? '-wild' : '-wild_draw_4';

    return legalActions.filter((item) =>
      item.action.endsWith(suffix),
    );
  }

  const action =
    `${COLOR_CODE[card.color]}-${toRlTrait(card.value)}`;

  return legalActions.filter((item) => item.action === action);
}

export function getWildAction(
  card: Card,
  selectedColor: Color,
  legalActions: ApiLegalAction[],
): ApiLegalAction | undefined {
  if (card.color !== null) return undefined;

  const suffix =
    card.value === 'wild' ? 'wild' : 'wild_draw_4';

  const action = `${COLOR_CODE[selectedColor]}-${suffix}`;

  return legalActions.find((item) => item.action === action);
}
