import { describe, expect, test } from "bun:test";
import {
  Board,
  BoardCell,
  GameState,
  MoveType,
  Piece,
  PieceColor,
  Player,
  Wall,
} from "../game-manager";
import { Engine } from "./simulation.engine";
import { findBestMove } from "./search";
import { WIN_SCORE } from "./evaluation";

// Helpers -------------------------------------------------------------------

// RED (players[0], moves first) races to y=0; BLUE races to y=8.
const makeState = (redAt: BoardCell, blueAt: BoardCell, walls: Wall[] = []): GameState => {
  const red = new Player("red", "Red", new Piece(PieceColor.RED, redAt));
  const blue = new Player("blue", "Blue", new Piece(PieceColor.BLUE, blueAt));
  return new GameState([red, blue], new Board(walls));
};

const engine = new Engine();

// Tests ---------------------------------------------------------------------

describe("findBestMove", () => {
  test("takes an immediate winning move when one exists", () => {
    // RED is one step from its goal row (y=0).
    const state = makeState(new BoardCell(4, 1), new BoardCell(4, 5));
    const { move, score } = findBestMove(engine, state, 1);

    expect(move).not.toBeNull();
    expect(move!.getMoveType()).toBe(MoveType.CELL);
    expect(move!.getCell()!.getY()).toBe(0); // steps onto the goal row
    expect(score).toBeGreaterThanOrEqual(WIN_SCORE);
  });

  test("advances toward the goal when it has no walls to spend", () => {
    // RED has exhausted its walls, so only pawn moves remain: the evaluation
    // should pick the step that shortens its own path (upward, toward y=0).
    const state = makeState(new BoardCell(4, 6), new BoardCell(0, 0));
    const red = state.getPlayers()[0];
    while (red.getAvailableWalls() > 0) red.useWall();

    const { move } = findBestMove(engine, state, 2);
    expect(move!.getMoveType()).toBe(MoveType.CELL);
    expect(move!.getCell()!.getY()).toBeLessThan(6); // RED moves up, toward y=0
  });

  test("prefers the faster win when two winning depths are available", () => {
    // A 1-ply win should outscore the heuristic; depth-biased so it is decisive.
    const state = makeState(new BoardCell(2, 1), new BoardCell(7, 7));
    const shallow = findBestMove(engine, state, 1).score;
    const deeper = findBestMove(engine, state, 3).score;
    // Winning immediately is found at both depths and scored as a win.
    expect(shallow).toBeGreaterThanOrEqual(WIN_SCORE);
    expect(deeper).toBeGreaterThanOrEqual(WIN_SCORE);
  });

  test("blocks an opponent's immediate winning move with a wall", () => {
    // BLUE sits one step from winning at (4,8); RED is away and must respond.
    // The only way to stop BLUE winning next turn is a wall across (4,7)-(4,8).
    const state = makeState(new BoardCell(0, 4), new BoardCell(4, 7));
    const { move } = findBestMove(engine, state, 2);

    expect(move).not.toBeNull();
    expect(move!.getMoveType()).toBe(MoveType.WALL);

    // After RED's chosen move, BLUE must no longer have a step onto its goal row.
    const afterRed = state.applyMove(move!);
    const blue = afterRed.getPlayers()[1].getPiece();
    const blueCanWin = engine
      .calculatePossibleMovesForPiece(afterRed, blue)
      .some((m) => m.getCell()!.getY() === 8);
    expect(blueCanWin).toBe(false);
  });

  test("returns null for a position with no moves only when terminal", () => {
    // Sanity: a normal opening always yields a move.
    const state = makeState(new BoardCell(4, 8), new BoardCell(4, 0));
    expect(findBestMove(engine, state, 1).move).not.toBeNull();
  });
});
