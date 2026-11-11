import random
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
import rlcard

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
NUM_ACTIONS = 61
EPISODES = 1000

class DQN(nn.Module):
    def __init__(self):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(240, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, NUM_ACTIONS)
        )

    def forward(self, x):
        return self.network(x)

def encode(state):
    return np.array(state["obs"], dtype=np.float32).reshape(-1)

model = DQN().to(DEVICE)
model_path = Path(__file__).resolve().parents[1] / "backend" / "models" / "uno_dqn.pt"
model.load_state_dict(torch.load(model_path, map_location=DEVICE))
model.eval()

def dqn_action(state):
    legal = list(state["legal_actions"].keys())
    obs = torch.tensor(
        encode(state), dtype=torch.float32, device=DEVICE
    ).unsqueeze(0)

    with torch.no_grad():
        q_values = model(obs)[0]

    masked = torch.full_like(q_values, -1e9)
    masked[legal] = q_values[legal]
    return int(masked.argmax().item())

def random_action(state):
    return random.choice(list(state["legal_actions"].keys()))

env = rlcard.make("uno")
wins = 0
seat_wins = [0, 0]
seat_games = [0, 0]
lengths = []

for episode in range(EPISODES):
    dqn_player = episode % 2
    state, player = env.reset()
    moves = 0

    while not env.is_over():
        if player == dqn_player:
            action = dqn_action(state)
        else:
            action = random_action(state)

        state, player = env.step(action)
        moves += 1

    won = env.get_payoffs()[dqn_player] > 0
    wins += int(won)
    seat_games[dqn_player] += 1
    seat_wins[dqn_player] += int(won)
    lengths.append(moves)

    if (episode + 1) % 100 == 0:
        print(
            f"Games: {episode + 1}/{EPISODES} | "
            f"Overall: {wins / (episode + 1):.1%} | "
            f"Avg moves: {np.mean(lengths):.1f}",
            flush=True
        )

print("\n=== SEAT-BALANCED EVALUATION ===")
print(f"Total games: {EPISODES}")
print(f"DQN wins: {wins}")
print(f"Random wins: {EPISODES - wins}")
print(f"Overall win rate: {wins / EPISODES:.1%}")
for seat in (0, 1):
    print(
        f"DQN as player {seat}: "
        f"{seat_wins[seat]}/{seat_games[seat]} "
        f"({seat_wins[seat] / seat_games[seat]:.1%})"
    )
print(f"Average game length: {np.mean(lengths):.1f} moves")
