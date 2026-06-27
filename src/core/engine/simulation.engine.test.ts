import { describe, expect, test } from "bun:test";
import {
  Board,
  BoardCell,
  GameState,
  Move,
  Piece,
  PieceColor,
  Player,
  Wall,
  WallOrientation,
} from "../game-manager";
import { buildBlockedEdges, Engine } from "./simulation.engine";

// Helpers -------------------------------------------------------------------

// RED races to the top row (y=0), BLUE races to the bottom row (y=8).
const makeState = (redAt: BoardCell, blueAt: BoardCell, walls: Wall[] = []): GameState => {
  const red = new Player("red", "Red", new Piece(PieceColor.RED, redAt));
  const blue = new Player("blue", "Blue", new Piece(PieceColor.BLUE, blueAt));
  return new GameState([red, blue], new Board(walls));
};

const hWall = (x: number, y: number) => new Wall(new BoardCell(x, y), WallOrientation.HORIZONTAL);
const vWall = (x: number, y: number) => new Wall(new BoardCell(x, y), WallOrientation.VERTICAL);

// A move that places `wall`, used to drive isPieceHavePathToWin.
const wallMove = (state: GameState, wall: Wall) =>
  new Move(state.getCurrentPlayer(), undefined, wall);

const cellMove = (state: GameState, x: number, y: number) =>
  new Move(state.getCurrentPlayer(), new BoardCell(x, y));

const engine = new Engine();

// Tests ---------------------------------------------------------------------

describe("buildBlockedEdges", () => {
  test("a horizontal wall blocks two vertical steps", () => {
    const blocked = buildBlockedEdges([hWall(3, 4)]);
    // Spans columns 3 and 4 across the groove between rows 4 and 5.
    expect(blocked.has("3,4|3,5")).toBe(true);
    expect(blocked.has("4,4|4,5")).toBe(true);
    expect(blocked.size).toBe(2);
  });

  test("a vertical wall blocks two horizontal steps", () => {
    const blocked = buildBlockedEdges([vWall(3, 4)]);
    // Spans rows 4 and 5 across the groove between columns 3 and 4.
    expect(blocked.has("3,4|4,4")).toBe(true);
    expect(blocked.has("3,5|4,5")).toBe(true);
    expect(blocked.size).toBe(2);
  });
});

describe("validatePieceMove (via isLegalMove)", () => {
  // Current player is RED (players[0]); place it in the center.
  const centeredState = (walls: Wall[] = []) =>
    makeState(new BoardCell(4, 4), new BoardCell(0, 0), walls);

  test("allows all four orthogonal steps on an open board", () => {
    const state = centeredState();
    expect(engine.isLegalMove(state, cellMove(state, 4, 3))).toBe(true); // up
    expect(engine.isLegalMove(state, cellMove(state, 4, 5))).toBe(true); // down
    expect(engine.isLegalMove(state, cellMove(state, 3, 4))).toBe(true); // left
    expect(engine.isLegalMove(state, cellMove(state, 5, 4))).toBe(true); // right
  });

  test("rejects non-steps: diagonal, two-away, and staying put", () => {
    const state = centeredState();
    expect(engine.isLegalMove(state, cellMove(state, 5, 5))).toBe(false); // diagonal
    expect(engine.isLegalMove(state, cellMove(state, 4, 6))).toBe(false); // two down
    expect(engine.isLegalMove(state, cellMove(state, 4, 4))).toBe(false); // same cell
  });

  test("a vertical wall blocks the horizontal step it closes, not the others", () => {
    // vWall(4,4) closes (4,4)->(5,4); the leftward step stays open.
    const state = centeredState([vWall(4, 4)]);
    expect(engine.isLegalMove(state, cellMove(state, 5, 4))).toBe(false); // right blocked
    expect(engine.isLegalMove(state, cellMove(state, 3, 4))).toBe(true); // left open
  });

  test("a horizontal wall blocks the vertical step it closes, not the others", () => {
    // hWall(4,4) closes (4,4)->(4,5); the upward step stays open.
    const state = centeredState([hWall(4, 4)]);
    expect(engine.isLegalMove(state, cellMove(state, 4, 5))).toBe(false); // down blocked
    expect(engine.isLegalMove(state, cellMove(state, 4, 3))).toBe(true); // up open
  });
});

describe("jumping over an adjacent opponent", () => {
  // RED (current player) is the mover; place the two pieces adjacent.
  test("cannot step onto the opponent's square — must jump over", () => {
    const state = makeState(new BoardCell(4, 4), new BoardCell(4, 3));
    expect(engine.isLegalMove(state, cellMove(state, 4, 3))).toBe(false); // onto opponent
    expect(engine.isLegalMove(state, cellMove(state, 4, 2))).toBe(true); // straight jump over
  });

  test("the jumped-over move is reported in generated moves, the opponent cell is not", () => {
    const state = makeState(new BoardCell(4, 4), new BoardCell(4, 3));
    const targets = engine
      .calculatePossibleMovesForPiece(state, state.getCurrentPlayer().getPiece())
      .map(m => m.getCell()!)
      .map(c => `${c.getX()},${c.getY()}`);
    expect(targets).toContain("4,2"); // landing beyond opponent
    expect(targets).not.toContain("4,3"); // opponent's own cell
    expect(targets).toContain("4,5"); // ordinary step away from opponent
  });

  test("a wall behind the opponent forces diagonal sidesteps", () => {
    // RED at (4,4), opponent at (4,3). A horizontal wall closes (4,3)->(4,2),
    // so the straight jump is blocked and the two diagonals open up.
    const state = makeState(new BoardCell(4, 4), new BoardCell(4, 3), [hWall(3, 2)]);
    expect(engine.isLegalMove(state, cellMove(state, 4, 2))).toBe(false); // straight blocked
    expect(engine.isLegalMove(state, cellMove(state, 3, 3))).toBe(true); // diagonal left
    expect(engine.isLegalMove(state, cellMove(state, 5, 3))).toBe(true); // diagonal right
  });

  test("the board edge behind the opponent also forces diagonal sidesteps", () => {
    // Opponent on the top row (y=0); RED at (4,1). Straight jump would land off
    // the board, so only the diagonal sidesteps along the top row are legal.
    const state = makeState(new BoardCell(4, 1), new BoardCell(4, 0));
    expect(engine.isLegalMove(state, cellMove(state, 3, 0))).toBe(true); // diagonal left
    expect(engine.isLegalMove(state, cellMove(state, 5, 0))).toBe(true); // diagonal right
  });

  test("a wall blocking a diagonal removes only that sidestep", () => {
    // Straight jump blocked behind the opponent, and the right diagonal is also
    // walled off, leaving just the left diagonal.
    const state = makeState(new BoardCell(4, 4), new BoardCell(4, 3), [
      hWall(3, 2), // blocks straight jump (4,3)->(4,2)
      vWall(4, 3), // blocks right diagonal (4,3)->(5,3)
    ]);
    expect(engine.isLegalMove(state, cellMove(state, 5, 3))).toBe(false); // right blocked
    expect(engine.isLegalMove(state, cellMove(state, 3, 3))).toBe(true); // left open
  });
});

describe("getWinner / isWinningState", () => {
  test("no winner while both pieces are off their goal rows", () => {
    const state = makeState(new BoardCell(4, 4), new BoardCell(4, 5));
    expect(engine.getWinner(state)).toBeNull();
    expect(engine.isWinningState(state)).toBe(false);
  });

  test("RED wins on reaching the top row (y=0)", () => {
    const state = makeState(new BoardCell(2, 0), new BoardCell(4, 5));
    expect(engine.getWinner(state)?.getId()).toBe("red");
    expect(engine.isWinningState(state)).toBe(true);
  });

  test("BLUE wins on reaching the bottom row (y=8)", () => {
    const state = makeState(new BoardCell(4, 4), new BoardCell(7, 8));
    expect(engine.getWinner(state)?.getId()).toBe("blue");
    expect(engine.isWinningState(state)).toBe(true);
  });

  test("a piece on the opponent's goal row (its own start side) is not a win", () => {
    // RED's goal is y=0; sitting on the bottom row y=8 must not count.
    const state = makeState(new BoardCell(4, 8), new BoardCell(4, 0));
    expect(engine.getWinner(state)).toBeNull();
    expect(engine.isWinningState(state)).toBe(false);
  });
});

describe("validateWallMove (via isLegalMove)", () => {
  // RED (current player) is well clear of any wall lines below.
  const wallState = (walls: Wall[] = []) =>
    makeState(new BoardCell(4, 0), new BoardCell(4, 8), walls);

  test("a wall on an open board is legal", () => {
    const state = wallState();
    expect(engine.isLegalMove(state, wallMove(state, hWall(3, 4)))).toBe(true);
    expect(engine.isLegalMove(state, wallMove(state, vWall(3, 4)))).toBe(true);
  });

  test("rejects a wall on an occupied anchor — same orientation (overlap)", () => {
    const state = wallState([hWall(3, 4)]);
    expect(engine.isLegalMove(state, wallMove(state, hWall(3, 4)))).toBe(false);
  });

  test("rejects a perpendicular wall crossing through the same anchor", () => {
    const state = wallState([hWall(3, 4)]);
    expect(engine.isLegalMove(state, wallMove(state, vWall(3, 4)))).toBe(false);
  });

  test("rejects a collinear wall one slot away (shared segment)", () => {
    const state = wallState([hWall(3, 4)]);
    expect(engine.isLegalMove(state, wallMove(state, hWall(4, 4)))).toBe(false); // overlaps column 4
    expect(engine.isLegalMove(state, wallMove(state, hWall(2, 4)))).toBe(false); // overlaps column 3
  });

  test("allows a collinear wall two slots away (end-to-end)", () => {
    const state = wallState([hWall(3, 4)]);
    expect(engine.isLegalMove(state, wallMove(state, hWall(5, 4)))).toBe(true);
    expect(engine.isLegalMove(state, wallMove(state, hWall(1, 4)))).toBe(true);
  });

  test("allows a perpendicular wall at a different anchor", () => {
    const state = wallState([hWall(3, 4)]);
    expect(engine.isLegalMove(state, wallMove(state, vWall(5, 5)))).toBe(true);
  });

  test("rejects a wall once the player's supply is exhausted", () => {
    const state = wallState();
    const red = state.getPlayers()[0];
    while (red.getAvailableWalls() > 0) red.useWall();
    expect(engine.isLegalMove(state, wallMove(state, hWall(3, 4)))).toBe(false);
  });

  test("calculatePossibleMovesForWalls returns legal placements on an open board", () => {
    const state = wallState();
    // 8x8 anchor grid × 2 orientations = 128 candidates; none seal a path on an
    // otherwise-empty board, so all are legal.
    expect(engine.calculatePossibleMovesForWalls(state).length).toBe(128);
  });
});

describe("isPieceHavePathToWin", () => {
  test("open board: any wall keeps both players solvable", () => {
    const state = makeState(new BoardCell(4, 8), new BoardCell(4, 0));
    expect(engine.isPieceHavePathToWin(state, wallMove(state, hWall(4, 4)))).toBe(true);
  });

  test("a near-complete wall line with a gap only detours (allowed)", () => {
    // Covers columns 0..7 across the groove between rows 4 and 5, leaving the
    // column-8 gap open, so RED can still snake through.
    const walls = [hWall(0, 4), hWall(2, 4), hWall(4, 4), hWall(6, 4)];
    const state = makeState(new BoardCell(4, 8), new BoardCell(4, 0), walls);
    expect(engine.isPieceHavePathToWin(state, wallMove(state, hWall(2, 4)))).toBe(true);
  });

  test("rejects the wall that completes a full line and seals a player off", () => {
    // The four existing walls cover columns 0..7; the move closes column 8 with
    // a wall covering columns 7..8, completing an unbroken line that cuts RED
    // (at the bottom, goal row y=0) off from the top half of the board.
    const walls = [hWall(0, 4), hWall(2, 4), hWall(4, 4), hWall(6, 4)];
    const state = makeState(new BoardCell(4, 8), new BoardCell(4, 0), walls);
    const closingWall = hWall(7, 4);
    expect(engine.isPieceHavePathToWin(state, wallMove(state, closingWall))).toBe(false);
  });

  test("checks BOTH players, not just the current one", () => {
    // Current player is RED (players[0]); it already sits on its goal row.
    // A full line across the groove between rows 7 and 8 seals BLUE (goal y=8)
    // away from the bottom row, so the move must still be rejected.
    const walls = [hWall(0, 7), hWall(2, 7), hWall(4, 7), hWall(6, 7)];
    const state = makeState(new BoardCell(4, 0), new BoardCell(4, 7), walls);
    const closingWall = hWall(7, 7);
    expect(engine.isPieceHavePathToWin(state, wallMove(state, closingWall))).toBe(false);
  });
});
