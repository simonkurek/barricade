import { describe, expect, test } from "bun:test";
import {
  Board,
  BoardCell,
  Game,
  GameState,
  Move,
  Piece,
  PieceColor,
  Player,
  Wall,
  WallOrientation,
} from "./game-manager";
import { Engine } from "./engine/simulation.engine";

// Helpers -------------------------------------------------------------------

// RED (players[0], moves first) races to the top row (y=0); BLUE to y=8.
const makeGame = (redAt: BoardCell, blueAt: BoardCell): { game: Game; red: Player; blue: Player } => {
  const red = new Player("red", "Red", new Piece(PieceColor.RED, redAt));
  const blue = new Player("blue", "Blue", new Piece(PieceColor.BLUE, blueAt));
  const state = new GameState([red, blue], new Board([]));
  return { game: new Game(state, new Engine()), red, blue };
};

const cellMove = (game: Game, x: number, y: number) =>
  new Move(game.getState().getCurrentPlayer(), new BoardCell(x, y));

// Tests ---------------------------------------------------------------------

describe("Game win integration", () => {
  test("a fresh game is not over and has no winner", () => {
    const { game } = makeGame(new BoardCell(4, 4), new BoardCell(4, 5));
    expect(game.isOver()).toBe(false);
    expect(game.getWinner()).toBeNull();
  });

  test("RED stepping onto its goal row wins the game", () => {
    const { game, red } = makeGame(new BoardCell(4, 1), new BoardCell(4, 5));
    game.executeMove(cellMove(game, 4, 0), red); // RED steps up onto y=0
    expect(game.isOver()).toBe(true);
    expect(game.getWinner()?.getId()).toBe("red");
  });

  test("the winning move does not flip the turn away from the winner", () => {
    const { game, red } = makeGame(new BoardCell(4, 1), new BoardCell(4, 5));
    game.executeMove(cellMove(game, 4, 0), red); // RED wins
    expect(game.getState().getCurrentPlayer().getId()).toBe("red");
  });

  test("no more moves are accepted once the game is over", () => {
    const { game, red, blue } = makeGame(new BoardCell(4, 1), new BoardCell(4, 7));
    game.executeMove(cellMove(game, 4, 0), red); // RED wins
    // It is now BLUE's turn per the flip, but the game has ended.
    expect(() => game.executeMove(cellMove(game, 4, 8), blue)).toThrow("Game is already over");
  });
});

// State cloning / simulation -------------------------------------------------

// Snapshot the bits of a state that minimax cares about, for equality checks.
const snapshot = (state: GameState) => ({
  currentPlayer: state.getCurrentPlayer().getId(),
  walls: state.getBoard().getWalls().length,
  positions: state.getPlayers().map((p) => {
    const c = p.getPiece().getPosition();
    return `${p.getId()}:${c.getX()},${c.getY()}:${p.getAvailableWalls()}`;
  }),
});

describe("GameState cloning & simulation", () => {
  const freshState = () => {
    const red = new Player("red", "Red", new Piece(PieceColor.RED, new BoardCell(4, 8)));
    const blue = new Player("blue", "Blue", new Piece(PieceColor.BLUE, new BoardCell(4, 0)));
    return new GameState([red, blue], new Board([new Wall(new BoardCell(2, 2), WallOrientation.HORIZONTAL)]));
  };

  test("clone reproduces the state exactly", () => {
    const state = freshState();
    expect(snapshot(state.clone())).toEqual(snapshot(state));
  });

  test("clone preserves whose turn it is, not just players[0]", () => {
    const state = freshState();
    const blueMove = new Move(state.getPlayers()[1], new BoardCell(4, 1));
    const afterRed = state.applyMove(new Move(state.getCurrentPlayer(), new BoardCell(4, 7)));
    expect(afterRed.getCurrentPlayer().getId()).toBe("blue");
    // Cloning a non-default turn keeps BLUE on the move.
    expect(afterRed.clone().getCurrentPlayer().getId()).toBe("blue");
    expect(afterRed.applyMove(blueMove).getCurrentPlayer().getId()).toBe("red");
  });

  test("mutating a clone does not affect the original (piece move)", () => {
    const state = freshState();
    const before = snapshot(state);
    const clone = state.clone();
    clone.transform(new Move(clone.getCurrentPlayer(), new BoardCell(4, 7)));
    // Original untouched; clone advanced.
    expect(snapshot(state)).toEqual(before);
    expect(clone.getPlayers()[0]!.getPiece().getPosition().getY()).toBe(7);
  });

  test("mutating a clone's walls does not leak into the original", () => {
    const state = freshState();
    const startWalls = state.getBoard().getWalls().length;
    const clone = state.clone();
    clone.transform(
      new Move(clone.getCurrentPlayer(), undefined, new Wall(new BoardCell(5, 5), WallOrientation.VERTICAL))
    );
    expect(state.getBoard().getWalls().length).toBe(startWalls);
    expect(clone.getBoard().getWalls().length).toBe(startWalls + 1);
    expect(clone.getCurrentPlayer().getId()).toBe("blue"); // turn flipped to BLUE after RED's wall
  });

  test("applyMove returns a new state and leaves the original unchanged", () => {
    const state = freshState();
    const before = snapshot(state);
    const next = state.applyMove(new Move(state.getCurrentPlayer(), new BoardCell(3, 8)));
    expect(next).not.toBe(state);
    expect(snapshot(state)).toEqual(before);
    expect(snapshot(next)).not.toEqual(before);
  });

  test("a wall move on a clone decrements only the clone's wall supply", () => {
    const state = freshState();
    const redWallsBefore = state.getPlayers()[0]!.getAvailableWalls();
    const next = state.applyMove(
      new Move(state.getCurrentPlayer(), undefined, new Wall(new BoardCell(5, 5), WallOrientation.VERTICAL))
    );
    expect(state.getPlayers()[0]!.getAvailableWalls()).toBe(redWallsBefore);
    expect(next.getPlayers()[0]!.getAvailableWalls()).toBe(redWallsBefore - 1);
  });
});
