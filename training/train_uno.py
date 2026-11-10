import random
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import rlcard

from collections import deque

DEVICE = torch.device(
    "mps" if torch.backends.mps.is_available() else "cpu"
)

NUM_ACTIONS = 61
EPISODES = 10000
BATCH_SIZE = 128
GAMMA = 0.99
LR = 0.0003
EPSILON = 1.0
EPSILON_MIN = 0.05
EPSILON_DECAY = 0.9995

print("Device:", DEVICE)


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


class ReplayBuffer:
    def __init__(self, capacity=100000):
        self.memory = deque(maxlen=capacity)

    def add(self, transition):
        self.memory.append(transition)

    def sample(self, batch_size):
        return random.sample(self.memory, batch_size)

    def __len__(self):
        return len(self.memory)


model = DQN().to(DEVICE)
target_model = DQN().to(DEVICE)
target_model.load_state_dict(model.state_dict())

optimizer = optim.Adam(model.parameters(), lr=LR)
buffer = ReplayBuffer()

epsilon = EPSILON


def encode(state):
    return np.array(state["obs"], dtype=np.float32).reshape(-1)


def choose_action(state):
    global epsilon

    legal = list(state["legal_actions"].keys())

    if random.random() < epsilon:
        return random.choice(legal)

    obs = torch.tensor(
        encode(state),
        dtype=torch.float32,
        device=DEVICE
    ).unsqueeze(0)

    with torch.no_grad():
        q_values = model(obs)[0]

    masked = torch.full_like(q_values, -1e9)
    masked[legal] = q_values[legal]

    return int(masked.argmax().item())


def train():
    if len(buffer) < BATCH_SIZE:
        return

    batch = buffer.sample(BATCH_SIZE)

    states = torch.tensor(
        np.array([x[0] for x in batch]),
        dtype=torch.float32,
        device=DEVICE
    )

    actions = torch.tensor(
        [x[1] for x in batch],
        dtype=torch.long,
        device=DEVICE
    )

    rewards = torch.tensor(
        [x[2] for x in batch],
        dtype=torch.float32,
        device=DEVICE
    )

    next_states = torch.tensor(
        np.array([x[3] for x in batch]),
        dtype=torch.float32,
        device=DEVICE
    )

    dones = torch.tensor(
        [x[4] for x in batch],
        dtype=torch.float32,
        device=DEVICE
    )

    next_masks = [x[5] for x in batch]

    q_values = model(states).gather(
        1, actions.unsqueeze(1)
    ).squeeze(1)

    with torch.no_grad():
        next_q = target_model(next_states)

        targets = []

        for i, mask in enumerate(next_masks):
            if dones[i]:
                targets.append(torch.tensor(0.0, device=DEVICE))
            else:
                masked = torch.full_like(next_q[i], -1e9)
                if mask:
                    masked[mask] = next_q[i][mask]
                    targets.append(masked.max())
                else:
                    targets.append(torch.tensor(0.0, device=DEVICE))

        targets = torch.stack(targets)
        targets = rewards + GAMMA * targets * (1 - dones)

    loss = nn.functional.smooth_l1_loss(q_values, targets)

    optimizer.zero_grad()
    loss.backward()
    nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()


def random_agent(state):
    return random.choice(list(state["legal_actions"].keys()))


env = rlcard.make("uno")

wins = 0

for episode in range(1, EPISODES + 1):
    state, player = env.reset()
    pending = None

    while not env.is_over():
        if player == 0:
            action = choose_action(state)
            pending = (encode(state), action)
        else:
            action = random_agent(state)

        next_state, next_player = env.step(action)

        if pending is not None and (env.is_over() or next_player == 0):
            reward = float(env.get_payoffs()[0]) if env.is_over() else 0.0
            done = env.is_over()
            next_legal = (
                [] if done
                else list(next_state["legal_actions"].keys())
            )

            old_state, old_action = pending
            buffer.add((
                old_state,
                old_action,
                reward,
                encode(next_state),
                done,
                next_legal
            ))

            train()
            pending = None

        state = next_state
        player = next_player

    if env.get_payoffs()[0] > 0:
        wins += 1

    epsilon = max(EPSILON_MIN, epsilon * EPSILON_DECAY)

    if episode % 100 == 0:
        print(
            f"Episode {episode}/{EPISODES} | "
            f"Win rate: {wins / 100:.1%} | "
            f"Epsilon: {epsilon:.3f} | "
            f"Buffer: {len(buffer)}",
            flush=True
        )
        wins = 0

    if episode % 500 == 0:
        target_model.load_state_dict(model.state_dict())

    if episode % 1000 == 0:
        torch.save(model.state_dict(), "uno_dqn.pt")
        print("Model saved", flush=True)

torch.save(model.state_dict(), "uno_dqn.pt")
print("Training complete!")
