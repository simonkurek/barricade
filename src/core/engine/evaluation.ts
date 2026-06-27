import { GameState, Player } from "../game-manager";
import { buildBlockedEdges, shortestPathToGoal } from "./simulation.engine";

/**
 * Score for a decided position. Large enough to dominate any path/wall
 * heuristic so the search always prefers a genuine win (or avoids a genuine
 * loss) over mere positional advantage. A search layer may offset this by depth
 * to favour faster wins and slower losses; the static evaluation itself stays
 * flat.
 */
export const WIN_SCORE = 1_000_000;

/** Points per step of shortest-path advantage — the dominant heuristic term. */
const PATH_WEIGHT = 3;

/**
 * Points per wall still in hand, relative to the opponent. Deliberately smaller
 * than PATH_WEIGHT: a reserve wall is useful leverage but worth less than
 * actually being a step closer to the goal.
 */
const WALL_WEIGHT = 1;

const opponentOf = (state: GameState, player: Player): Player => {
  const opponent = state.getPlayers().find((other) => other.getId() !== player.getId());
  if (!opponent) {
    throw new Error("Game state has no opponent for the given player");
  }
  return opponent;
};

/**
 * Static evaluation of `state` from `player`'s point of view: positive favours
 * `player`, negative favours the opponent, zero is balanced. The function is
 * antisymmetric — evaluate(state, a) === -evaluate(state, b) for the two
 * players — so a minimax search can negate freely.
 *
 * Terms, in order of weight:
 *  - shortest-path difference: how many fewer steps `player` needs than the
 *    opponent (each pawn's path ignores the other pawn, since jumping can only
 *    ever shorten a route, never lengthen it);
 *  - walls in hand: a smaller bonus for retained barricades.
 *
 * The heuristic is turn-agnostic — it scores the position, not whose move it is;
 * tempo is the search's concern, not the static evaluation's. A decided position
 * short-circuits to ±WIN_SCORE.
 */
export const evaluate = (state: GameState, player: Player): number => {
  const opponent = opponentOf(state, player);
  const blockedEdges = buildBlockedEdges(state.getBoard().getWalls());

  const myDistance = shortestPathToGoal(player.getPiece(), blockedEdges);
  const opponentDistance = shortestPathToGoal(opponent.getPiece(), blockedEdges);

  // Rules guarantee both pawns always retain a route, but never let a sealed-off
  // pawn read as anything other than lost/won.
  if (myDistance === null) return -WIN_SCORE;
  if (opponentDistance === null) return WIN_SCORE;

  // A pawn already on its goal row has won the game.
  if (myDistance === 0) return WIN_SCORE;
  if (opponentDistance === 0) return -WIN_SCORE;

  const pathScore = (opponentDistance - myDistance) * PATH_WEIGHT;
  const wallScore = (player.getAvailableWalls() - opponent.getAvailableWalls()) * WALL_WEIGHT;
  return pathScore + wallScore;
};
