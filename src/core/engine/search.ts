import { GameState, Move, MoveType } from "../game-manager";
import { Engine } from "./simulation.engine";
import { evaluate, WIN_SCORE } from "./evaluation";

/**
 * Default look-ahead in plies. Quoridor's branching factor is large (≈ 4 pawn
 * steps + up to ~128 wall placements) and every generated wall runs a BFS
 * legality check, so each node is expensive. Depth 2 is a sensible, responsive
 * default; callers can ask for more when they can afford the wait.
 */
export const DEFAULT_SEARCH_DEPTH = 2;

export type SearchResult = {
  /** Best move for the side to move, or null if the position has no moves. */
  move: Move | null;
  /** Negamax score from the side-to-move's perspective (positive is good). */
  score: number;
};

/**
 * Cheap, allocation-free move ordering to make alpha-beta prune sooner: try the
 * pawn steps that advance toward the goal first (they tend to be strong and
 * raise alpha quickly), then sideways/backward pawn steps, then wall placements.
 * Stable sort, so ordering is deterministic. Deliberately avoids applying moves
 * or running BFS here — wall generation is already the per-node bottleneck.
 */
const orderMoves = (state: GameState, moves: Move[]): Move[] => {
  const piece = state.getCurrentPlayer().getPiece();
  const goalRow = piece.getGoalRow();
  const fromDistance = Math.abs(piece.getPosition().getY() - goalRow);

  const rank = (move: Move): number => {
    if (move.getMoveType() === MoveType.WALL) return 2;
    const toDistance = Math.abs(move.getCell()!.getY() - goalRow);
    return toDistance < fromDistance ? 0 : 1;
  };

  return [...moves].sort((a, b) => rank(a) - rank(b));
};

/**
 * Score a child reached by applying `move` to `state`, from the perspective of
 * the player who just moved. A move that wins outright is scored directly as
 * WIN_SCORE biased by remaining depth (so a win found sooner — with more depth
 * left — outranks a slower one, and a forced loss is delayed as long as
 * possible). Crucially this avoids recursing into a won position: GameState does
 * not flip the turn on a winning move, which would otherwise break negamax's
 * negation. Non-winning children recurse normally with the sign flipped.
 */
const scoreChild = (
  engine: Engine,
  state: GameState,
  move: Move,
  depth: number,
  alpha: number,
  beta: number
): number => {
  const child = state.applyMove(move);
  if (engine.isWinningState(child)) {
    return WIN_SCORE + depth;
  }
  return -negamax(engine, child, depth - 1, -beta, -alpha);
};

/**
 * Negamax with alpha-beta pruning. Returns the value of `state` from the side to
 * move's perspective. Leaves (depth exhausted, or an already-decided position)
 * are scored by the static evaluation, which is antisymmetric — hence a single
 * negated recursion handles both players.
 */
const negamax = (
  engine: Engine,
  state: GameState,
  depth: number,
  alpha: number,
  beta: number
): number => {
  if (depth === 0 || engine.isWinningState(state)) {
    return evaluate(state, state.getCurrentPlayer());
  }

  const moves = orderMoves(state, engine.calculatePossibleMoves(state));
  let best = -Infinity;
  for (const move of moves) {
    const score = scoreChild(engine, state, move, depth, alpha, beta);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff: opponent won't allow this line
  }
  return best;
};

/**
 * Searches for the best move for the side to move in `state`, looking `depth`
 * plies ahead. Returns the chosen move and its score; the move is null only when
 * the position is terminal or otherwise has no legal moves.
 */
export const findBestMove = (
  engine: Engine,
  state: GameState,
  depth: number = DEFAULT_SEARCH_DEPTH
): SearchResult => {
  const moves = orderMoves(state, engine.calculatePossibleMoves(state));
  if (moves.length === 0) {
    return { move: null, score: evaluate(state, state.getCurrentPlayer()) };
  }

  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const move of moves) {
    const score = scoreChild(engine, state, move, depth, alpha, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return { move: bestMove, score: bestScore };
};
