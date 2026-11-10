import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import main
from rlcard.games.uno.card import UnoCard
from rlcard.games.uno.utils import ACTION_LIST


class UnoApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.game_ids = []

    def tearDown(self):
        with main.sessions_lock:
            for game_id in self.game_ids:
                main.sessions.pop(game_id, None)

    def create_game(self):
        response = self.client.post("/game/new")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.game_ids.append(data["game_id"])
        return data, main.sessions[data["game_id"]]

    def prepare_state(self, session):
        env = session["env"]
        session["current_player"] = 0
        env.game.round.current_player = 0
        session["state"] = env._extract_state(env.game.get_state(0))

    def prepare_uno(self, session):
        env = session["env"]
        hand = env.game.players[0].hand
        chosen = next(card for card in hand if card.type == "number")
        other = next(card for card in hand if card is not chosen)

        env.game.players[0].hand = [chosen, other]
        env.game.round.target = UnoCard(
            chosen.type, chosen.color, chosen.trait
        )
        self.prepare_state(session)

        action_id = next(
            action_id
            for action_id in session["state"]["legal_actions"]
            if ACTION_LIST[action_id] == chosen.get_str()
        )
        return action_id

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["model"], "loaded")

    def test_new_game_and_get_state(self):
        data, _ = self.create_game()
        self.assertEqual(data["status"], "playing")
        self.assertEqual(data["current_player"], 0)
        self.assertEqual(len(data["your_hand"]), data["num_cards"][0])
        self.assertFalse(data["uno_pending"])

        response = self.client.get(f"/game/{data['game_id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["game_id"], data["game_id"])

    def test_unknown_game_returns_404(self):
        response = self.client.get("/game/unknown-game")
        self.assertEqual(response.status_code, 404)

    def test_illegal_action_returns_400(self):
        data, _ = self.create_game()
        response = self.client.post(
            f"/game/{data['game_id']}/action",
            json={"action_id": -1},
        )
        self.assertEqual(response.status_code, 400)

    def test_not_your_turn_returns_409(self):
        data, session = self.create_game()
        session["current_player"] = 1

        response = self.client.post(
            f"/game/{data['game_id']}/action",
            json={"action_id": 0},
        )
        self.assertEqual(response.status_code, 409)

    def test_dqn_selects_only_legal_action(self):
        _, session = self.create_game()
        decision = main.get_model_decision(session["state"])

        self.assertIn(
            decision["action_id"],
            session["state"]["legal_actions"],
        )
        self.assertTrue(decision["legal_action_values"])

    def test_wild_color_controls_legal_cards(self):
        _, session = self.create_game()
        env = session["env"]

        env.game.players[0].hand = [
            UnoCard("number", "y", "9"),
            UnoCard("number", "r", "9"),
        ]
        target = UnoCard("wild", "r", "wild")
        target.color = "y"
        env.game.round.target = target
        self.prepare_state(session)

        legal = {
            ACTION_LIST[action_id]
            for action_id in session["state"]["legal_actions"]
        }

        self.assertIn("y-9", legal)
        self.assertNotIn("r-9", legal)
        self.assertEqual(main.public_state(session)["target"], "y-wild")

    def test_draw_action_adds_card(self):
        data, session = self.create_game()
        env = session["env"]

        env.game.players[0].hand = [
            UnoCard("number", "g", "8"),
            UnoCard("number", "y", "9"),
        ]
        env.game.round.target = UnoCard("number", "r", "5")
        env.game.dealer.deck.append(UnoCard("number", "b", "3"))
        self.prepare_state(session)

        draw_id = next(
            action_id
            for action_id in session["state"]["legal_actions"]
            if ACTION_LIST[action_id] == "draw"
        )

        response = self.client.post(
            f"/game/{data['game_id']}/action",
            json={"action_id": draw_id},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(len(session["env"].game.players[0].hand), 3)

    def test_uno_declaration(self):
        data, session = self.create_game()
        action_id = self.prepare_uno(session)

        response = self.client.post(
            f"/game/{data['game_id']}/action",
            json={"action_id": action_id},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["uno_pending"])
        self.assertEqual(len(session["env"].game.players[0].hand), 1)

        response = self.client.post(
            f"/game/{data['game_id']}/uno/declare"
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["uno_pending"])
        self.assertIn("Player called UNO!", response.json()["events"])

    def test_uno_penalty_adds_two_cards(self):
        data, session = self.create_game()
        action_id = self.prepare_uno(session)

        response = self.client.post(
            f"/game/{data['game_id']}/action",
            json={"action_id": action_id},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["uno_pending"])

        response = self.client.post(
            f"/game/{data['game_id']}/uno/penalty"
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["uno_pending"])
        self.assertEqual(len(session["env"].game.players[0].hand), 3)
        self.assertIn(
            "UNO missed: penalty +2 cards",
            response.json()["events"],
        )

    def test_uno_declare_without_pending_returns_409(self):
        data, _ = self.create_game()
        response = self.client.post(
            f"/game/{data['game_id']}/uno/declare"
        )
        self.assertEqual(response.status_code, 409)

    def test_uno_penalty_without_pending_returns_409(self):
        data, _ = self.create_game()
        response = self.client.post(
            f"/game/{data['game_id']}/uno/penalty"
        )
        self.assertEqual(response.status_code, 409)

    def test_finished_game_rejects_action(self):
        data, session = self.create_game()
        session["env"].game.round.is_over = True
        response = self.client.post(
            "/game/" + data["game_id"] + "/action",
            json={"action_id": 0},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Game is finished")


if __name__ == "__main__":
    unittest.main()
