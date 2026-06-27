import { describe, expect, test } from "bun:test";
import {
  Board,
  BoardCell,
  GameState,
  Piece,
  PieceColor,
  Player,
  Wall,
  WallOrientation,
} from "../game-manager";
import { buildBlockedEdges, shortestPathToGoal } from "./simulation.engine";
import { evaluate, WIN_SCORE } from "./evaluation";

// Helpers -------------------------------------------------------------------

// RED races to the top row (y=0), BLUE to the bottom (y=8).
const makeState = (
  redAt: BoardCell,
  blueAt: BoardCell,
  walls: Wall[] = [],
  redWalls = 10,
  blueWalls = 10
): { state: GameState; red: Player; blue: Player } => {
  const red = new Player("red", "Red", new Piece(PieceColor.RED, redAt));
  const blue = new Player("blue", "Blue", new Piece(PieceColor.BLUE, blueAt));
  for (let i = 0; i < 10 - redWalls; i++) red.useWall();
  for (let i = 0; i < 10 - blueWalls; i++) blue.useWall();
  return { state: new GameState([red, blue], new Board(walls)), red, blue };
};

// Tests ---------------------------------------------------------------------

describe("shortestPathToGoal", () => {
  test("counts straight-line steps to the goal row on an open board", () => {
    const red = new Piece(PieceColor.RED, new BoardCell(4, 8)); // 8 steps up to y=0
    expect(shortestPathToGoal(red, buildBlockedEdges([]))).toBe(8);
  });

  test("is 0 when the pawn already sits on its goal row", () => {
    const red = new Piece(PieceColor.RED, new BoardCell(3, 0));
    expect(shortestPathToGoal(red, buildBlockedEdges([]))).toBe(0);
  });

  test("a wall directly ahead forces a longer detour", () => {
    const red = new Piece(PieceColor.RED, new BoardCell(0, 1)); // one step from goal
    const open = buildBlockedEdges([]);
    expect(shortestPathToGoal(red, open)).toBe(1);

    // HORIZONTAL wall at (0,0) seals the grooves above columns 0 and 1, so the
    // pawn must detour right to column 2 before climbing to row 0.
    const walled = buildBlockedEdges([new Wall(new BoardCell(0, 0), WallOrientation.HORIZONTAL)]);
    expect(shortestPathToGoal(red, walled)).toBe(3);
  });
});

describe("evaluate", () => {
  test("the symmetric opening position is balanced (0)", () => {
    const { state, red } = makeState(new BoardCell(4, 8), new BoardCell(4, 0));
    expect(evaluate(state, red)).toBe(0);
  });

  test("is antisymmetric between the two players", () => {
    const { state, red, blue } = makeState(
      new BoardCell(4, 3),
      new BoardCell(2, 1),
      [new Wall(new BoardCell(5, 5), WallOrientation.VERTICAL)],
      8,
      10
    );
    expect(evaluate(state, red)).toBe(-evaluate(state, blue));
  });

  test("being closer to goal scores positively", () => {
    // RED needs 2 steps, BLUE needs 8 — RED is well ahead.
    const { state, red, blue } = makeState(new BoardCell(4, 2), new BoardCell(4, 0));
    expect(evaluate(state, red)).toBeGreaterThan(0);
    expect(evaluate(state, blue)).toBeLessThan(0);
  });

  test("with equal paths, holding more walls is an advantage", () => {
    // Mirror positions — RED at (4,5) is 5 steps from y=0, BLUE at (4,3) is 5
    // steps from y=8 — so the path term is 0 and only the wall count differs.
    const { state, red } = makeState(new BoardCell(4, 5), new BoardCell(4, 3), [], 10, 7);
    expect(evaluate(state, red)).toBe(3); // (10 - 7) walls × WALL_WEIGHT(1)
  });

  test("a pawn on its goal row evaluates as a win / loss", () => {
    const { state, red, blue } = makeState(new BoardCell(1, 0), new BoardCell(4, 4));
    expect(evaluate(state, red)).toBe(WIN_SCORE);
    expect(evaluate(state, blue)).toBe(-WIN_SCORE);
  });
});
