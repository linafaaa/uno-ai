# UNO AI — Play Against a Deep Q-Network

A browser-based UNO game where you play against an AI agent powered by a trained Deep Q-Network (DQN).

The project combines an Expo / React Native frontend with a FastAPI backend, using RLCard as the game environment and PyTorch for AI inference.

## Live Demo

https://demounogame.duckdns.org

## Features

- Play UNO against a trained DQN agent.
- Legal-action masking prevents invalid AI moves.
- Inspect AI decisions, Q-values and legal alternatives.
- View the game event log and AI decision history.
- Declare UNO and handle UNO penalties.
- Responsive browser-based interface.

## Tech Stack

**Frontend**
- Expo SDK 58
- React 19
- React Native
- Expo Router
- React Native Web
- TypeScript

**Backend and AI**
- Python
- FastAPI
- PyTorch
- RLCard 1.2.0
- NumPy
- Uvicorn

## Architecture

    React Native / Expo frontend
               |
               | HTTP + JSON
               v
           FastAPI backend
               |
               v
          RLCard UNO engine
               |
               v
          PyTorch DQN agent
               |
               v
        Legal action selection
               |
               v
         Game state and AI data

The backend manages game sessions, validates player actions, advances the game and invokes the AI agent when it is the bot's turn.

The frontend communicates with the backend through the API and renders the current game state.

## AI Agent

The game uses a trained Deep Q-Network checkpoint:

`backend/models/uno_dqn.pt`

| Property | Value |
|---|---:|
| Observation size | 240 |
| Hidden layer 1 | 256 |
| Hidden layer 2 | 256 |
| Output size | 61 |
| Inference device | CPU |

### Decision-making process

1. The agent receives the current game observation.
2. The backend obtains legal action IDs from the game environment.
3. PyTorch calculates Q-values using the trained network.
4. Illegal actions are masked so they cannot be selected.
5. The agent chooses the legal action with the highest Q-value.
6. The backend returns the selected action and decision metadata.

The API exposes Q-values for legal alternatives, making the agent's decisions easier to inspect in the game interface.

This repository contains the inference service and trained checkpoint. The model-training pipeline is maintained separately.

## Project Structure

    uno-mobile/
    ├── backend/
    │   ├── main.py
    │   ├── models/
    │   │   └── uno_dqn.pt
    │   ├── tests/
    │   │   └── test_api.py
    │   ├── requirements.txt
    │   └── requirements-dev.txt
    ├── src/
    │   ├── app/
    │   │   └── index.tsx
    │   └── game/
    │       ├── api.ts
    │       ├── api-view.ts
    │       └── engine.ts
    ├── app.json
    └── package.json

## Run Locally

### Requirements

- Node.js and npm
- Python 3.11 or newer
- Trained model checkpoint at `backend/models/uno_dqn.pt`

### 1. Install frontend dependencies

From the project root:

    npm install

### 2. Set up the backend

Create and activate a virtual environment:

    python3 -m venv .venv
    source .venv/bin/activate

Install dependencies:

    python -m pip install --upgrade pip
    python -m pip install -r backend/requirements.txt

### 3. Start the backend

With the virtual environment activated:

    cd backend
    uvicorn main:app --reload --host 127.0.0.1 --port 8000

### 4. Start the frontend

Open a second terminal:

    cd uno-mobile
    npm run web

The frontend reads its API base address from `EXPO_PUBLIC_API_URL`. If this variable is not set, it uses the local development API address.

For a remotely hosted frontend, configure `EXPO_PUBLIC_API_URL` with a backend address reachable by the browser. A remote browser cannot use another machine's loopback address to reach the backend.

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Backend and model health check |
| POST | `/game/new` | Create a new game |
| GET | `/game/{game_id}` | Retrieve game state |
| POST | `/game/{game_id}/action` | Submit a player action |
| POST | `/game/{game_id}/uno/declare` | Declare UNO |
| POST | `/game/{game_id}/uno/penalty` | Apply the UNO penalty |

Player actions use a JSON request body:

    {
      "action_id": 12
    }

The action ID must correspond to one of the legal actions returned in the current game state.

## Tests

Install development dependencies:

    source .venv/bin/activate
    python -m pip install -r backend/requirements-dev.txt

Run backend tests from the project root:

    python -m unittest discover -s backend/tests -v

The backend test suite covers:

- Health checks and game creation.
- Game state retrieval and unknown sessions.
- Illegal actions and turn validation.
- DQN legal-action selection.
- Wild card color handling.
- Drawing cards.
- UNO declaration and penalties.
- Finished-game behavior.

Frontend checks:

    npx tsc --noEmit
    npm run lint

## Current Limitations

- Game sessions are stored in backend process memory and are lost when the backend restarts.
- The current session store is not designed for multi-instance horizontal scaling.
- Persistent player accounts and database-backed game history are not implemented.
- Model inference currently runs on CPU.
- The frontend requires a reachable backend API.
- The current backend CORS configuration is permissive and should be restricted before production use.

## License and Copyright

Copyright (c) 2026 Lina Favorskaya. All rights reserved.

This repository is publicly available for viewing and evaluation purposes only.

No permission is granted to use, copy, modify, reproduce, distribute, sublicense, or commercially exploit any part of this project without prior written permission from the copyright holder.

The source code and model checkpoint are not licensed for public reuse. For licensing inquiries or permission requests, please contact the project owner.
