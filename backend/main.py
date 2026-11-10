import os
import uuid
import threading
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import rlcard

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rlcard.games.uno.utils import ACTION_LIST


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(
    os.getenv("UNO_MODEL_PATH", str(BASE_DIR / "models" / "uno_dqn.pt"))
)

DEVICE = torch.device("cpu")
NUM_ACTIONS = 61


class DQN(nn.Module):
    def __init__(self):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(240, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, NUM_ACTIONS),
        )

    def forward(self, x):
        return self.network(x)


if not MODEL_PATH.is_file():
    raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

model = DQN().to(DEVICE)
model.load_state_dict(
    torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
)
model.eval()


app = FastAPI(
    title="UNO DQN API",
    description="UNO game powered by a trained PyTorch DQN agent.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


sessions = {}
sessions_lock = threading.RLock()


class ActionRequest(BaseModel):
    action_id: int


def get_model_decision(state):
    legal_ids = list(state["legal_actions"].keys())

    if not legal_ids:
        raise RuntimeError("DQN received no legal actions")

    observation = np.asarray(
        state["obs"], dtype=np.float32
    ).reshape(-1)

    tensor = torch.tensor(
        observation, dtype=torch.float32, device=DEVICE
    ).unsqueeze(0)

    with torch.no_grad():
        q_values = model(tensor)[0]

    masked = torch.full_like(q_values, -1e9)
    masked[legal_ids] = q_values[legal_ids]

    action_id = int(masked.argmax().item())

    legal_values = [
        {
            "action_id": int(i),
            "action": ACTION_LIST[i],
            "q_value": float(q_values[i].item()),
        }
        for i in legal_ids
    ]

    return {
        "action_id": action_id,
        "action": ACTION_LIST[action_id],
        "q_value": float(q_values[action_id].item()),
        "legal_action_values": legal_values,
    }


def public_state(session):
    env = session["env"]

    # Всегда извлекаем наблюдение именно игрока 0.
    state = env.get_state(0)
    raw = state["raw_obs"]

    legal = []
    if not env.is_over() and session["current_player"] == 0:
        legal = [
            {
                "action_id": int(i),
                "action": ACTION_LIST[i],
            }
            for i in state["legal_actions"].keys()
        ]

    payoffs = env.get_payoffs() if env.is_over() else None

    return {
        "game_id": session["id"],
        "status": "finished" if env.is_over() else "playing",
        "current_player": session["current_player"],
        "your_hand": list(raw["hand"]),
        "target": env.game.round.target.get_str(),
        "played_cards": list(raw["played_cards"]),
        "num_cards": list(raw["num_cards"]),
        "legal_actions": legal,
        "last_ai_decision": session["last_ai_decision"],
        "ai_history": list(session["ai_history"]),
        "events": list(session["events"]),
        "uno_pending": bool(session.get("uno_pending", False)),
        "result": (
            {
                "payoffs": [float(x) for x in payoffs],
                "you_won": bool(payoffs[0] > 0),
            }
            if payoffs is not None
            else None
        ),
    }


def run_bot_turns(session):
    env = session["env"]

    while (
        not env.is_over()
        and session["current_player"] == 1
        and not session.get("uno_pending", False)
    ):
        cards_before = len(env.game.players[1].hand)
        state = session["state"]
        decision = get_model_decision(state)

        session["last_ai_decision"] = decision
        session["ai_history"].append(decision)
        session["events"].append(f"AI action: {decision['action']}")

        next_state, next_player = env.step(decision["action_id"])

        session["state"] = next_state
        session["current_player"] = next_player

        if (
            not env.is_over()
            and cards_before == 2
            and len(env.game.players[1].hand) == 1
        ):
            session["events"].append("AI called UNO!")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "loaded",
        "model_file": MODEL_PATH.name,
        "device": str(DEVICE),
        "architecture": "240-256-256-61",
    }


@app.post("/game/new")
def new_game():
    env = rlcard.make("uno")
    state = None
    player = None

    for _ in range(100):
        state, player = env.reset()
        if player == 0:
            break

    if player != 0:
        raise RuntimeError("Could not initialize game with human player 0 after 100 attempts")

    game_id = str(uuid.uuid4())

    session = {
        "id": game_id,
        "env": env,
        "state": state,
        "current_player": player,
        "last_ai_decision": None,
        "ai_history": [],
        "events": ["Game started"],
        "uno_pending": False,
    }

    with sessions_lock:
        sessions[game_id] = session

    return public_state(session)


@app.get("/game/{game_id}")
def get_game(game_id: str):
    with sessions_lock:
        session = sessions.get(game_id)

        if session is None:
            raise HTTPException(status_code=404, detail="Game not found")

        return public_state(session)


@app.post("/game/{game_id}/action")
def submit_action(game_id: str, request: ActionRequest):
    with sessions_lock:
        session = sessions.get(game_id)

        if session is None:
            raise HTTPException(status_code=404, detail="Game not found")

        env = session["env"]

        if env.is_over():
            raise HTTPException(status_code=409, detail="Game is finished")

        if session["current_player"] != 0:
            raise HTTPException(status_code=409, detail="Not your turn")

        if session.get("uno_pending", False):
            raise HTTPException(
                status_code=409,
                detail="Declare UNO or accept the +2 penalty first",
            )

        cards_before = len(env.game.players[0].hand)
        legal_ids = list(session["state"]["legal_actions"].keys())

        if request.action_id not in legal_ids:
            raise HTTPException(
                status_code=400,
                detail="Illegal action",
            )

        session["events"].append(
            f"Player action: {ACTION_LIST[request.action_id]}"
        )

        next_state, next_player = env.step(request.action_id)

        session["state"] = next_state
        session["current_player"] = next_player

        if (
            not env.is_over()
            and cards_before == 2
            and len(env.game.players[0].hand) == 1
        ):
            session["uno_pending"] = True
            session["events"].append("You have one card left — call UNO!")
        else:
            run_bot_turns(session)

        return public_state(session)


@app.post("/game/{game_id}/uno/declare")
def declare_uno(game_id: str):
    with sessions_lock:
        session = sessions.get(game_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Game not found")
        if not session.get("uno_pending", False):
            raise HTTPException(status_code=409, detail="UNO declaration is not pending")

        session["uno_pending"] = False
        session["events"].append("Player called UNO!")

        if not session["env"].is_over() and session["current_player"] == 1:
            run_bot_turns(session)

        return public_state(session)


@app.post("/game/{game_id}/uno/penalty")
def accept_uno_penalty(game_id: str):
    with sessions_lock:
        session = sessions.get(game_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Game not found")
        if not session.get("uno_pending", False):
            raise HTTPException(status_code=409, detail="UNO penalty is not pending")

        env = session["env"]
        session["uno_pending"] = False

        if len(env.game.dealer.deck) < 2:
            env.game.round.replace_deck()

        env.game.dealer.deal_cards(env.game.players[0], 2)
        session["events"].append("UNO missed: penalty +2 cards")

        current_player = session["current_player"]
        session["state"] = env._extract_state(
            env.game.get_state(current_player)
        )

        if not env.is_over() and current_player == 1:
            run_bot_turns(session)

        return public_state(session)
