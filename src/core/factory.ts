import {
  Board,
  BoardCell,
  BOARD_SIZE,
  GameState,
  Piece,
  PieceColor,
  Player,
} from "./game-manager";

/**
 * Builds the standard opening position: both pawns on the centre column (`e`,
 * x = 4) of their own back row, with RED on the bottom row racing up to y = 0
 * and BLUE on the top row racing down to y = 8. RED is players[0], so RED moves
 * first — matching "Player 1 moves first" in the rules.
 *
 * Shared by the UI, tests, and (later) the bot so every entry point starts from
 * an identical, rules-accurate board.
 */
export const createInitialGameState = (): GameState => {
  const centreColumn = Math.floor(BOARD_SIZE / 2);

  const red = new Player(
    "p1",
    "Player 1 (RED)",
    new Piece(PieceColor.RED, new BoardCell(centreColumn, BOARD_SIZE - 1))
  );
  const blue = new Player(
    "p2",
    "Player 2 (BLUE)",
    new Piece(PieceColor.BLUE, new BoardCell(centreColumn, 0))
  );

  return new GameState([red, blue], new Board([]));
};
