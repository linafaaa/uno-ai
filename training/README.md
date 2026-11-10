# UNO DQN Training

## Overview

This directory contains the original training script for the UNO Deep Q-Network (DQN) model.

The model is implemented in PyTorch and trained in the UNO environment provided by RLCard.

The DQN agent plays as player 0 against a custom random-policy opponent that selects uniformly from the legal actions provided by RLCard.

## Model Architecture

- Input: 240 features
- Hidden layer 1: 256 neurons, ReLU
- Hidden layer 2: 256 neurons, ReLU
- Output: 61 action values

Legal-action masking is used during action selection.

## Training Configuration

| Parameter | Value |
|---|---:|
| Episodes | 10,000 |
| Batch size | 128 |
| Discount factor (gamma) | 0.99 |
| Learning rate | 0.0003 |
| Initial epsilon | 1.0 |
| Minimum epsilon | 0.05 |
| Epsilon decay | 0.9995 |
| Replay buffer capacity | 100,000 |
| Target network update interval | 500 episodes |

The implementation uses experience replay, a target network, epsilon-greedy action selection, the Adam optimizer, Huber loss, and gradient clipping.

## Environment and Dependencies

The game environment and observation representation are provided by RLCard.

The training script uses the observation vector supplied by RLCard. It does not implement a separate UNO observation encoder.

Tested environment versions:

- Python 3.10.20
- RLCard 1.2.0
- PyTorch 2.14.1
- NumPy 2.2.6

Install dependencies:

    pip install -r requirements.txt

Run training from this directory:

    python train_uno.py

## Checkpoints

The script periodically saves model weights and saves them again at the end of training.

The checkpoint contains model weights only. Optimizer state, replay buffer contents, and epsilon state are not saved.

## Reproducibility and Limitations

The original script does not set fixed random seeds. Different training runs may therefore produce different results.

The saved checkpoint does not contain the complete training state required to resume the exact training process.

The training setup uses a random opponent. Performance against a random agent should not be interpreted as evidence of competitive strength against advanced UNO strategies.

No performance claims are made here. Evaluation results should be reported separately, together with the evaluation methodology and sample size.
