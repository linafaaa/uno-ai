import React, { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Card, Color } from '@/game/engine';
import {
  createApiGame,
  submitApiAction,
  declareApiUno,
  acceptUnoPenalty,
  getLegalActionsForCard,
  getWildAction,
  type ApiGameState,
} from '@/game/api';
import { toApiGameView } from '@/game/api-view';

const COLORS: Record<Color, string> = {
  red: '#F04444',
  blue: '#2879F5',
  green: '#35B96B',
  yellow: '#F7C843',
};

const LABELS: Record<string, string> = {
  skip: '⊘',
  reverse: '↻',
  draw2: '+2',
  wild: 'W',
  wild4: '+4',
};

function CardView({
  card,
  small = false,
  disabled = false,
  onPress,
}: {
  card: Card;
  small?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const background = card.color ? COLORS[card.color] : '#292936';
  const label = LABELS[card.value] ?? card.value;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.card,
        small && styles.smallCard,
        { backgroundColor: background },
        disabled && styles.disabledCard,
      ]}
    >
      <View style={styles.cardInner}>
        <Text style={[styles.cardValue, small && styles.smallValue]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [game, setGame] = useState<ApiGameState | null>(null);
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    createApiGame()
      .then((state) => {
        if (active) {
          setGame(state);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not connect to AI server');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const view = game ? toApiGameView(game) : null;
  const myTurn = game?.status === 'playing' && game.current_player === 0;
  const legalActions = game?.legal_actions ?? [];

  async function sendAction(actionId: number) {
    if (!game || loading) return;

    setLoading(true);
    setError(null);

    try {
      const nextState = await submitApiAction(game.game_id, actionId);
      setGame(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeclareUno() {
    if (!game || loading || !game.uno_pending) return;
    setLoading(true);
    setError(null);
    try {
      setGame(await declareApiUno(game.game_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not declare UNO');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnoPenalty() {
    if (!game || loading || !game.uno_pending) return;
    setLoading(true);
    setError(null);
    try {
      setGame(await acceptUnoPenalty(game.game_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply UNO penalty');
    } finally {
      setLoading(false);
    }
  }

  function handleCardPress(card: Card) {
    if (!game || !myTurn || loading) return;

    const actions = getLegalActionsForCard(card, legalActions);
    if (actions.length === 0) return;

    if (card.color === null) {
      setPendingWild(card);
      return;
    }

    void sendAction(actions[0].action_id);
  }

  function chooseWildColor(color: Color) {
    if (!pendingWild || !game || loading) return;

    const action = getWildAction(pendingWild, color, legalActions);
    if (action) {
      setPendingWild(null);
      void sendAction(action.action_id);
    }
  }

  function handleDraw() {
    if (!game || !myTurn || loading) return;

    const drawAction = legalActions.find((item) => item.action === 'draw');
    if (drawAction) void sendAction(drawAction.action_id);
  }

  async function restart() {
    setPendingWild(null);
    setLoading(true);
    setError(null);

    try {
      const nextState = await createApiGame();
      setGame(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a new game');
    } finally {
      setLoading(false);
    }
  }

  const currentStatus =
    loading && !game
      ? 'CONNECTING TO AI...'
      : error && !game
        ? 'SERVER UNAVAILABLE'
        : game?.status === 'finished'
          ? view?.winner === 0
            ? 'YOU WIN!'
            : 'AI WINS'
          : game?.uno_pending
            ? 'UNO! ONE CARD LEFT'
            : loading
              ? 'AI IS THINKING...'
            : myTurn
              ? 'YOUR TURN'
              : 'AI IS THINKING...';

  if (!game || !view) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
          <Text style={styles.logo}>UNO<Text style={styles.logoDot}>.</Text></Text>
          <Text style={styles.turn}>{currentStatus}</Text>
          {error ? <Text style={{ color: '#F04444' }}>{error}</Text> : null}
          <Pressable style={styles.drawButton} onPress={restart} disabled={loading}>
            <Text style={styles.drawButtonText}>{loading ? 'CONNECTING...' : 'TRY AGAIN'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const canDraw = legalActions.some((item) => item.action === 'draw');
  const aiDecision = game.last_ai_decision;
  const topAlternatives = aiDecision
    ? [...aiDecision.legal_action_values]
        .sort((a, b) => b.q_value - a.q_value)
        .slice(0, 3)
    : [];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <Text style={styles.logo}>UNO<Text style={styles.logoDot}>.</Text></Text>
        <Text style={styles.headerLabel}>DQN AI MODE</Text>
      </View>

      <View style={styles.gameInfo}>
        <Text style={styles.round}>1 VS 1</Text>
        <Text style={styles.turn}>{currentStatus}</Text>
        {error ? <Text style={{ color: '#F04444', fontSize: 10 }}>{error}</Text> : null}
      </View>

      <View style={styles.opponent}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AI</Text>
        </View>
        <View>
          <Text style={styles.playerName}>DQN PLAYER</Text>
          <Text style={styles.playerSub}>{view.opponentCardCount} cards remaining</Text>
        </View>
        <View style={styles.opponentCards}>
          {Array.from({ length: Math.min(5, view.opponentCardCount) }).map((_, index) => (
            <View key={index} style={styles.backCard}>
              <Text style={styles.backLogo}>UNO</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.pileArea}>
          <Pressable
            style={[styles.deck, (!myTurn || !canDraw || loading) && styles.mutedButton]}
            onPress={handleDraw}
            disabled={!myTurn || !canDraw || loading}
          >
            <Text style={styles.deckLogo}>UNO</Text>
          </Pressable>
          <Text style={styles.deckLabel}>DRAW PILE</Text>
          <Text style={styles.pileCount}>—</Text>
        </View>

        <View style={styles.pileArea}>
          <CardView card={view.topCard} />
          <Text style={styles.deckLabel}>DISCARD PILE</Text>
          <Text style={styles.pileCount}>{view.discardCount}</Text>
        </View>
      </View>

      <View style={styles.colorIndicator}>
        <Text style={styles.colorLabel}>CURRENT COLOR</Text>
        <View style={[styles.colorDot, { backgroundColor: COLORS[view.currentColor] }]} />
        <Text style={styles.colorName}>{view.currentColor.toUpperCase()}</Text>
      </View>

      {aiDecision ? (
        <View style={{ backgroundColor: '#191920', borderRadius: 12, borderWidth: 1, borderColor: '#292932', padding: 10, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.eventLogTitle}>DQN DECISION</Text>
            <Text style={{ color: '#F7C843', fontSize: 10, fontWeight: '800' }}>
              Q {aiDecision.q_value.toFixed(3)}
            </Text>
          </View>
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginBottom: 5 }}>
            Selected action: {aiDecision.action}
          </Text>
          {topAlternatives.map((item, index) => (
            <Text key={`${item.action_id}-${index}`} style={{ color: '#A5A5B0', fontSize: 9, lineHeight: 14 }}>
              {index + 1}. {item.action} · Q {item.q_value.toFixed(3)}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.playerSection}>
        <View style={styles.playerHeader}>
          <View>
            <Text style={styles.youLabel}>YOUR HAND</Text>
            <Text style={styles.cardCount}>{view.hand.length} CARDS</Text>
          </View>
          <Text style={{ color: '#777780', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
            {game.uno_pending ? 'CALL UNO NOW' : myTurn ? 'YOUR MOVE' : 'AI TURN'}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
          {view.hand.map((card) => {
            const isLegal = getLegalActionsForCard(card, legalActions).length > 0;
            return (
              <CardView
                key={card.id}
                card={card}
                small
                disabled={!myTurn || !isLegal || game.status === 'finished' || loading}
                onPress={() => handleCardPress(card)}
              />
            );
          })}
        </ScrollView>

        {game.uno_pending ? (
          <View style={styles.actions}>
            <Pressable
              style={[styles.unoButton, loading && styles.mutedButton]}
              onPress={handleDeclareUno}
              disabled={loading}
            >
              <Text style={styles.unoText}>CALL UNO</Text>
            </Pressable>
            <Pressable
              style={[styles.passButton, loading && styles.mutedButton]}
              onPress={handleUnoPenalty}
              disabled={loading}
            >
              <Text style={styles.drawButtonText}>TAKE +2</Text>
            </Pressable>
          </View>
        ) : game.status === 'finished' ? (
          <Pressable style={styles.drawButton} onPress={restart} disabled={loading}>
            <Text style={styles.drawButtonText}>NEW GAME</Text>
          </Pressable>
        ) : (
          <View style={styles.actions}>
            <Pressable
              style={[styles.drawButton, (!myTurn || !canDraw || loading) && styles.mutedButton]}
              onPress={handleDraw}
              disabled={!myTurn || !canDraw || loading}
            >
              <Text style={styles.drawButtonText}>DRAW A CARD</Text>
            </Pressable>
          </View>
        )}
      </View>

      {pendingWild ? (
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>CHOOSE A COLOR</Text>
          <View style={styles.colorChoices}>
            {(Object.keys(COLORS) as Color[]).map((color) => (
              <Pressable
                key={color}
                onPress={() => chooseWildColor(color)}
                style={[styles.colorChoice, { backgroundColor: COLORS[color] }]}
                disabled={loading}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.eventLog}>
        <View style={styles.eventLogHeader}>
          <Text style={styles.eventLogTitle}>GAME LOG</Text>
          <Pressable style={styles.copyButton} onPress={() => Clipboard.setStringAsync(game.events.join('\n'))}>
            <Text style={styles.copyButtonText}>COPY ALL</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.eventLogList} nestedScrollEnabled>
          {[...game.events].reverse().map((event, index) => (
            <Text key={`${game.events.length}-${index}`} style={styles.eventLogText}>
              {event}
            </Text>
          ))}
        </ScrollView>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>UNO MOBILE</Text>
        <Text style={styles.footerText}>V 0.2.0</Text>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101014',
    paddingHorizontal: 20,
  },
  pageScroll: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
  },
  logo: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -2,
  },
  logoDot: { color: '#F04444' },
  headerLabel: {
    color: '#777780',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  gameInfo: {
    alignItems: 'center',
    marginTop: 18,
    gap: 6,
  },
  round: {
    color: '#777780',
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '700',
  },
  turn: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  opponent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#282832',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontWeight: '900' },
  playerName: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  playerSub: { color: '#777780', fontSize: 10, marginTop: 4 },
  opponentCards: { flexDirection: 'row', marginLeft: 'auto' },
  backCard: {
    width: 25,
    height: 36,
    borderRadius: 5,
    backgroundColor: '#252530',
    borderWidth: 1,
    borderColor: '#666675',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  backLogo: { color: '#F7C843', fontSize: 7, fontWeight: '900' },
  table: {
    flex: 0,
    minHeight: 180,
    maxHeight: 270,
    backgroundColor: '#191920',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#292932',
    marginTop: 20,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 35,
  },
  pileArea: { alignItems: 'center', gap: 9 },
  deck: {
    width: 72,
    height: 106,
    borderRadius: 10,
    backgroundColor: '#272735',
    borderWidth: 2,
    borderColor: '#777780',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckLogo: {
    color: '#F7C843',
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  card: {
    width: 72,
    height: 106,
    borderRadius: 10,
    padding: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInner: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-25deg' }],
  },
  cardValue: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  smallCard: { width: 65, height: 98, borderRadius: 9 },
  smallValue: { fontSize: 29 },
  disabledCard: { opacity: 0.42 },
  deckLabel: {
    color: '#777780',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  pileCount: { color: '#555560', fontSize: 9 },
  colorIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 15,
  },
  colorLabel: {
    color: '#777780',
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  colorDot: { width: 9, height: 9, borderRadius: 5 },
  colorName: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  playerSection: { gap: 12 },
  playerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  youLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  cardCount: {
    color: '#777780',
    fontSize: 9,
    marginTop: 5,
    letterSpacing: 1.5,
  },
  unoButton: {
    backgroundColor: '#F7C843',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
  },
  unoText: {
    color: '#171717',
    fontSize: 12,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  hand: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 7,
  },
  actions: { gap: 8 },
  drawButton: {
    backgroundColor: '#252530',
    borderWidth: 1,
    borderColor: '#41414D',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 8,
  },
  mutedButton: { opacity: 0.4 },
  passButton: {
    backgroundColor: '#343440',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  drawButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  footerText: {
    color: '#555560',
    fontSize: 8,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  eventLog: {
    backgroundColor: '#191920',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#292932',
    padding: 10,
    marginTop: 10,
    marginBottom: 10,
    maxHeight: 125,
  },
  eventLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  copyButton: {
    backgroundColor: '#F7C843',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
  },
  copyButtonText: {
    color: '#101014',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  eventLogTitle: {
    color: '#F7C843',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 6,
  },
  eventLogList: {
    maxHeight: 85,
  },
  eventLogText: {
    color: '#C8C8D0',
    fontSize: 10,
    lineHeight: 16,
    marginBottom: 2,
  },
  modal: {
    position: 'absolute',
    top: '40%',
    left: 30,
    right: 30,
    backgroundColor: '#252530',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555560',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 22,
  },
  colorChoices: { flexDirection: 'row', gap: 14 },
  colorChoice: { width: 48, height: 48, borderRadius: 15 },
});