import { Engine } from "./engine/simulation.engine";

export const BOARD_SIZE = 9;
export const LENGTH_OF_WALL = 2;

export class Game {
  private state: GameState;
  private engine: Engine;

  constructor(state: GameState, engine: Engine) {
    this.state = state;
    this.engine = engine;
  }

  public getState(): GameState {
    return this.state;
  }

  public executeMove(move: Move, player: Player){
    if (this.isOver()) {
      throw new Error("Game is already over")
    }
    if (player.getId() !== this.state.getCurrentPlayer().getId()) {
      throw new Error("Other player turn")
    }
    const legal = this.engine.isLegalMove(this.state, move)
    if (!legal) {
      throw new Error("Illegal move!")
    }
    this.state.transform(move)
  }

  /** The player who has won, or null if the game is still in progress. */
  public getWinner(): Player | null {
    return this.engine.getWinner(this.state)
  }

  /** Whether the game has finished (a player has reached their goal row). */
  public isOver(): boolean {
    return this.engine.isWinningState(this.state)
  }
}

export class GameState {
  private players: [Player, Player];
  private board: Board;
  private currentPlayer: Player;

  constructor(players: [Player, Player], board: Board) {
    this.players = players;
    this.board = board;
    this.currentPlayer = players[0];
  }

  public getPlayers(): [Player, Player] {
    return this.players;
  }

  public getBoard(): Board {
    return this.board;
  }

  public getCurrentPlayer(): Player {
    return this.currentPlayer;
  }

  private flipCurrentPlayer() {
    if (this.currentPlayer.getId() === this.players[0].getId()){
      this.currentPlayer = this.players[1]
    } else {
      this.currentPlayer = this.players[0]
    }
  }

  public transform(move: Move){
    if (move.getMoveType() === MoveType.WALL){
      this.board.addWall(move.getWall()!)
      this.currentPlayer.useWall()
    }
    if (move.getMoveType() === MoveType.CELL) {
      const targetPiece = this.currentPlayer.getPiece()
      targetPiece.updatePosition(move.getCell()!)
    }
    // Once a piece has reached its goal row the game is won, so the turn stays
    // with the winner rather than flipping to the (now irrelevant) opponent.
    if (!this.hasWinner()) {
      this.flipCurrentPlayer()
    }
  }

  /**
   * A deep, independent copy of this state. Players, the board, and the pieces
   * are cloned; the immutable leaves (BoardCell, Wall, WallOrientation) are
   * shared since they are never mutated in place. The clone preserves whose turn
   * it is — the GameState constructor defaults currentPlayer to players[0], so
   * we re-point it at the cloned player matching the original's turn.
   */
  public clone(): GameState {
    const players = this.players.map(player => player.clone()) as [Player, Player]
    const cloned = new GameState(players, this.board.clone())
    cloned.currentPlayer = players.find(
      player => player.getId() === this.currentPlayer.getId()
    )!
    return cloned
  }

  /**
   * Non-mutating transition: returns a fresh state with `move` applied, leaving
   * this state untouched. This is the primitive a minimax / alpha-beta search is
   * built on — descend into a child position without corrupting the parent.
   * Callers must pass a legal move (move generation guarantees this);
   * `applyMove` does not re-validate.
   */
  public applyMove(move: Move): GameState {
    const next = this.clone()
    next.transform(move)
    return next
  }

  /** True once any player's piece sits on its goal row — see Piece.getGoalRow. */
  private hasWinner(): boolean {
    return this.players.some(player => {
      const piece = player.getPiece()
      return piece.getPosition().getY() === piece.getGoalRow()
    })
  }
}

export class Player {
  private id: string;
  private name: string;
  private piece: Piece;
  private availableWalls: number;

  constructor(id: string, name: string, piece: Piece) {
    this.id = id;
    this.name = name;
    this.piece = piece;
    this.availableWalls = 10;
  }

  public getId(): string {
    return this.id;
  }

  public getName(): string {
    return this.name;
  }

  public getPiece(): Piece {
    return this.piece;
  }

  public getAvailableWalls(): number {
    return this.availableWalls;
  }

  public useWall() {
    return this.availableWalls--
  }

  /** A copy with its own piece and wall count — see GameState.clone. */
  public clone(): Player {
    const copy = new Player(this.id, this.name, this.piece.clone())
    copy.availableWalls = this.availableWalls
    return copy
  }
}

export class Board {
  private walls: Wall[] = [];

  constructor(walls: Wall[]) {
    this.walls = walls;
  }

  public getWalls(): Wall[] {
    return this.walls;
  }

  public addWall(wall: Wall) {
    return this.walls.push(wall)
  }

  /**
   * A copy with its own walls array. Wall objects are immutable, so copying the
   * array is enough to isolate later addWall calls from the original board.
   */
  public clone(): Board {
    return new Board([...this.walls])
  }
}

export class Wall {
  private position: BoardCell;
  private orientation: WallOrientation;

  constructor(position: BoardCell, orientation: WallOrientation) {
    if (
      position.getX() > BOARD_SIZE - LENGTH_OF_WALL ||
      position.getY() > BOARD_SIZE - LENGTH_OF_WALL 
    ) {
      throw new Error("Cannot place wall outside of board!")
    }
    this.position = position;
    this.orientation = orientation;
  }

  getOrientation(){
    return this.orientation
  }

  getPosition(){
    return this.position
  }
}

export class WallOrientation {
  private orientation: 'HORIZONTAL' | 'VERTICAL';

  public static HORIZONTAL = new WallOrientation('HORIZONTAL')

  public static VERTICAL = new WallOrientation('VERTICAL')

  constructor(orientation: 'HORIZONTAL' | 'VERTICAL') {
    this.orientation = orientation;
  }

  public getOrientation(): 'HORIZONTAL' | 'VERTICAL' {
    return this.orientation;
  }

  public equals(anotherWallOrientation: WallOrientation){
    return anotherWallOrientation.getOrientation() === this.getOrientation()
  }
}

export class PositionOffset {
  private x: number;
  private y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  public getX(): number {
    return this.x;
  }

  public getY(): number {
    return this.y;
  }
}

export class BoardCell {
  private x: number;
  private y: number;

  constructor(x: number, y: number) {
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
      throw new Error('Invalid board cell');
    }
    this.x = x;
    this.y = y;
  }

  public getX(): number {
    return this.x;
  }

  public getY(): number {
    return this.y;
  }

  public transform(positionOffset: PositionOffset){
    return new BoardCell(this.x + positionOffset.getX(), this.y + positionOffset.getY())
  }
}

export enum PieceColor {
  RED = 'RED',
  BLUE = 'BLUE',
}

export class Piece {
  private color: PieceColor;
  private position: BoardCell;

  constructor(color: PieceColor, position: BoardCell) {
    this.color = color;
    this.position = position;
  }

  public getColor(): PieceColor {
    return this.color;
  }

  public getPosition(): BoardCell {
    return this.position;
  }

  /**
   * The row this piece must reach to win. By convention RED races to the top
   * row (y = 0) and BLUE races to the bottom row (y = BOARD_SIZE - 1).
   */
  public getGoalRow(): number {
    return this.color === PieceColor.RED ? 0 : BOARD_SIZE - 1;
  }

  public updatePosition(newPosition: BoardCell){
    return this.position = newPosition
  }

  /**
   * A copy of this piece. BoardCell is immutable (updatePosition swaps in a new
   * one rather than mutating it), so the position can be shared with the copy.
   */
  public clone(): Piece {
    return new Piece(this.color, this.position)
  }
}

export enum MoveType {
  CELL = 'CELL',
  WALL = 'WALL',
}

export class Move {
  private player: Player;
  private cell?: BoardCell;
  private wall?: Wall;

  public static from(player: Player, moveCode: string): Move {
    // moveCode is a string like "e3", or "he4" or "vf3"
    const moveType = moveCode.length === 2 ? MoveType.CELL : moveCode.length === 3 ? MoveType.WALL : undefined;
    if (!moveType) {
      throw new Error('Invalid move code');
    }

    if (moveType === MoveType.CELL) {
      const xChar = moveCode.charAt(0);
      const yChar = moveCode.charAt(1);
      const x = xChar.charCodeAt(0) - 'a'.charCodeAt(0);
      const y = BOARD_SIZE - Number(yChar);
      return new Move(player, new BoardCell(x, y));
    }
    if (moveType === MoveType.WALL) {
      const xChar = moveCode.charAt(1);
      const yChar = moveCode.charAt(2);
      const x = xChar.charCodeAt(0) - 'a'.charCodeAt(0);
      const y = BOARD_SIZE - Number(yChar);
      const orientation = moveCode.charAt(0) === 'v' ? 'VERTICAL' : moveCode.charAt(0) === 'h' ? 'HORIZONTAL' : undefined;
      if (!orientation) {
        throw new Error('Invalid move code');
      }
      return new Move(player, undefined, new Wall(new BoardCell(x, y), new WallOrientation(orientation)));
    }
    throw new Error('Invalid move code');
  }

  constructor(
    player: Player,
    cell?: BoardCell,
    wall?: Wall
  ) {
    if (!cell && !wall) {
      throw new Error('Move must have a cell or a wall');
    }
    this.player = player;
    this.cell = cell;
    this.wall = wall;
  }

  public getPlayer(): Player {
    return this.player;
  }

  public getCell(): BoardCell | undefined {
    return this.cell;
  }

  public getWall(): Wall | undefined {
    return this.wall;
  }

  public getTarget(): BoardCell | Wall {
    if (this.cell) {
      return this.cell;
    }
    if (this.wall) {
      return this.wall;
    }
    throw new Error('Move must have a cell or a wall');
  }

  public getMoveType(): MoveType {
    if (this.cell) {
      return MoveType.CELL;
    }
    if (this.wall) {
      return MoveType.WALL;
    }
    throw new Error('Move must have a cell or a wall');
  }
}