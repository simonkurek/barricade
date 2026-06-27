import { BOARD_SIZE, BoardCell, GameState, LENGTH_OF_WALL, Move, MoveType, Piece, Player, PositionOffset, Wall, WallOrientation } from "../game-manager";

export const ONE_UP_OFFSET = new PositionOffset(0, -1)
export const ONE_DOWN_OFFSET = new PositionOffset(0, 1)
export const ONE_LEFT_OFFSET = new PositionOffset(-1, 0)
export const ONE_RIGHT_OFFSET = new PositionOffset(1, 0)
export enum OperationResultStatus {
  SUCCESS = "SUCCESS",
  FAIL = "FAIL"
}

export type OperationResult<T> = {
  status: OperationResultStatus.SUCCESS
  transformed: T
} | {
  status: OperationResultStatus.FAIL
  transformed: null
}

export const tryToTransform = (boardCell: BoardCell, offset: PositionOffset): OperationResult<BoardCell> => {
  try {
    return {
      transformed: boardCell.transform(offset),
      status: OperationResultStatus.SUCCESS
    }
  } catch {
    return {
      transformed: null,
      status: OperationResultStatus.FAIL
    }
  }
}

export const tryToCreateWall = (boardCell: BoardCell, orientation: WallOrientation): OperationResult<Wall> => {
  try {
    return {
      transformed: new Wall(boardCell, orientation),
      status: OperationResultStatus.SUCCESS
    }
  } catch {
    return {
      transformed: null,
      status: OperationResultStatus.FAIL
    }
  }
}

const coordKey = (x: number, y: number): string => `${x},${y}`

const samePosition = (a: BoardCell, b: BoardCell): boolean =>
  a.getX() === b.getX() && a.getY() === b.getY()

/**
 * The two offsets perpendicular to a step. Used for diagonal sidesteps when a
 * straight jump over the opponent is blocked: a horizontal step yields the
 * up/down sidesteps, a vertical step yields the left/right ones.
 */
const perpendicularOffsets = (offset: PositionOffset): [PositionOffset, PositionOffset] => [
  new PositionOffset(offset.getY(), offset.getX()),
  new PositionOffset(-offset.getY(), -offset.getX()),
]

/**
 * A direction-agnostic key for the edge (groove) between two orthogonally
 * adjacent cells, so a step and its reverse hash to the same value.
 */
const edgeKey = (ax: number, ay: number, bx: number, by: number): string => {
  const a = coordKey(ax, ay)
  const b = coordKey(bx, by)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Builds the set of board edges that the given walls block. Each wall spans two
 * cells and therefore closes two parallel steps:
 *  - a HORIZONTAL wall at (x, y) blocks the vertical steps in columns x and x+1
 *    across the groove between rows y and y+1;
 *  - a VERTICAL wall at (x, y) blocks the horizontal steps in rows y and y+1
 *    across the groove between columns x and x+1.
 */
export const buildBlockedEdges = (walls: Wall[]): Set<string> => {
  const blocked = new Set<string>()
  for (const wall of walls) {
    const x = wall.getPosition().getX()
    const y = wall.getPosition().getY()
    if (wall.getOrientation().equals(WallOrientation.HORIZONTAL)) {
      blocked.add(edgeKey(x, y, x, y + 1))
      blocked.add(edgeKey(x + 1, y, x + 1, y + 1))
    } else {
      blocked.add(edgeKey(x, y, x + 1, y))
      blocked.add(edgeKey(x, y + 1, x + 1, y + 1))
    }
  }
  return blocked
}

/**
 * Breadth-first search for the fewest steps a piece needs to reach any cell on
 * its goal row, treating blocked edges as impassable and ignoring pieces (a pawn
 * never permanently blocks a path — it can be jumped or stepped around — so only
 * walls matter). Returns the step count, 0 if the piece already sits on its goal
 * row, or null if walls have sealed every route (which the rules forbid, but
 * callers should still handle).
 *
 * BFS over an unweighted grid, so the first time the goal row is dequeued its
 * recorded distance is the shortest. Shared by the path-to-win legality guard
 * (distance !== null) and the evaluation heuristic (the distance itself).
 */
export const shortestPathToGoal = (piece: Piece, blockedEdges: Set<string>): number | null => {
  const goalRow = piece.getGoalRow()
  const offsets = [ONE_UP_OFFSET, ONE_DOWN_OFFSET, ONE_LEFT_OFFSET, ONE_RIGHT_OFFSET]

  const start = piece.getPosition()
  const queue: BoardCell[] = [start]
  const distance = new Map<string, number>([[coordKey(start.getX(), start.getY()), 0]])

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const currentDistance = distance.get(coordKey(current.getX(), current.getY()))!
    if (current.getY() === goalRow) {
      return currentDistance
    }
    for (const offset of offsets) {
      const step = tryToTransform(current, offset)
      if (step.status !== OperationResultStatus.SUCCESS) {
        continue
      }
      const neighbour = step.transformed
      const neighbourKey = coordKey(neighbour.getX(), neighbour.getY())
      if (distance.has(neighbourKey)) {
        continue
      }
      if (blockedEdges.has(edgeKey(current.getX(), current.getY(), neighbour.getX(), neighbour.getY()))) {
        continue
      }
      distance.set(neighbourKey, currentDistance + 1)
      queue.push(neighbour)
    }
  }
  return null
}

export class Engine {

  public calculatePossibleMoves(gameState: GameState): Move[] {
    return [
      ...this.calculatePossibleMovesForPiece(gameState, gameState.getCurrentPlayer().getPiece()),
      ...this.calculatePossibleMovesForWalls(gameState)
    ]
  }

  /**
   * The game is won the moment a piece reaches any cell on its goal row
   * (RED → top row y=0, BLUE → bottom row y=8). This is the only win condition
   * the engine can observe from board state; resignation and timeout are handled
   * outside the rules layer. Returns the winning player, or null if neither
   * piece has reached its goal yet.
   */
  public getWinner(gameState: GameState): Player | null {
    return gameState.getPlayers().find(player => {
      const piece = player.getPiece()
      return piece.getPosition().getY() === piece.getGoalRow()
    }) ?? null
  }

  /** Whether the game has been won — see getWinner for the win condition. */
  public isWinningState(gameState: GameState): boolean {
    return this.getWinner(gameState) !== null
  }

  public calculatePossibleMovesForPiece(gameState: GameState, piece: Piece): Move[] {
    const blockedEdges = buildBlockedEdges(gameState.getBoard().getWalls())
    const opponentCell = this.getOpponentCell(gameState, piece)

    return this.legalDestinations(piece.getPosition(), opponentCell, blockedEdges)
      .map(targetCell => new Move(gameState.getCurrentPlayer(), targetCell))
  }

  public calculatePossibleMovesForWalls(gameState: GameState): Move[] {
    const legalPotentialWalls: Move[] = []
    for (let x = 0; x <= BOARD_SIZE - LENGTH_OF_WALL; x++) {
      for (let y = 0; y <= BOARD_SIZE - LENGTH_OF_WALL; y++) {
        const potentialWalls = [
          tryToCreateWall(
            new BoardCell(x, y),
            new WallOrientation("HORIZONTAL")
          ),
          tryToCreateWall(
            new BoardCell(x, y),
            new WallOrientation("VERTICAL")
          )
        ].filter(wallIntent => wallIntent.status === OperationResultStatus.SUCCESS)
          .map(wallResult => wallResult.transformed)
          .map(wall => new Move(gameState.getCurrentPlayer(), undefined, wall))
          .filter(wall => this.isLegalMove(gameState, wall))
        legalPotentialWalls.push(...potentialWalls)
      }
    }
    return legalPotentialWalls
  }

  public isLegalMove(gameState: GameState, move: Move): boolean {
    if (move.getMoveType() === MoveType.CELL) {
      return this.validatePieceMove(gameState, move)
    }
    return this.validateWallMove(gameState, move)
  }

  /**
   * Two placed walls conflict when they cannot physically coexist:
   *  - they share the same anchor slot — either an identical placement, or a
   *    perpendicular pair crossing through the shared centre post; or
   *  - they share an orientation and overlap along their length. A wall spans
   *    LENGTH_OF_WALL cells, so two collinear walls one slot apart share a
   *    segment and overlap; two slots apart sit end-to-end and are fine.
   */
  private wallsConflict(a: Wall, b: Wall): boolean {
    const ax = a.getPosition().getX()
    const ay = a.getPosition().getY()
    const bx = b.getPosition().getX()
    const by = b.getPosition().getY()

    if (ax === bx && ay === by) {
      return true
    }
    if (!a.getOrientation().equals(b.getOrientation())) {
      return false
    }
    if (a.getOrientation().equals(WallOrientation.HORIZONTAL)) {
      return ay === by && Math.abs(ax - bx) < LENGTH_OF_WALL
    }
    return ax === bx && Math.abs(ay - by) < LENGTH_OF_WALL
  }

  private validateWallMove(gameState: GameState, move: Move): boolean {
    if (gameState.getCurrentPlayer().getAvailableWalls() <= 0) {
      return false
    }
    const newWall = move.getWall()!
    const conflicts = gameState.getBoard().getWalls()
      .some(existing => this.wallsConflict(newWall, existing))
    if (conflicts) {
      return false
    }
    return this.isPieceHavePathToWin(gameState, move)
  }
  
  /**
   * A piece move is legal when its target is one of the destinations reachable
   * from the piece's current cell — a plain orthogonal step, a straight jump
   * over an adjacent opponent, or a diagonal sidestep when that jump is blocked.
   * Both validation and move generation share `legalDestinations`, so they can
   * never disagree.
   */
  private validatePieceMove(gameState: GameState, move: Move): boolean {
    const targetCell = move.getTarget() as BoardCell;
    const piece = gameState.getCurrentPlayer().getPiece()
    const blockedEdges = buildBlockedEdges(gameState.getBoard().getWalls())
    const opponentCell = this.getOpponentCell(gameState, piece)

    return this.legalDestinations(piece.getPosition(), opponentCell, blockedEdges)
      .some(cell => samePosition(cell, targetCell))
  }

  /** The cell occupied by the player who is NOT moving this piece, if any. */
  private getOpponentCell(gameState: GameState, piece: Piece): BoardCell | undefined {
    return gameState.getPlayers()
      .map(player => player.getPiece())
      .find(other => other !== piece)
      ?.getPosition()
  }

  /**
   * Returns the cell reached by stepping `offset` from `from`, or null if that
   * step leaves the board or is closed by a wall.
   */
  private tryStep(from: BoardCell, offset: PositionOffset, blockedEdges: Set<string>): BoardCell | null {
    const step = tryToTransform(from, offset)
    if (step.status !== OperationResultStatus.SUCCESS) {
      return null
    }
    const to = step.transformed
    if (blockedEdges.has(edgeKey(from.getX(), from.getY(), to.getX(), to.getY()))) {
      return null
    }
    return to
  }

  /**
   * Every cell the piece at `start` may legally land on this turn:
   *  - a plain step into any open, unoccupied orthogonal neighbour;
   *  - when a neighbour holds the opponent, a straight jump to the cell beyond it
   *    (if that onward step is open and on-board);
   *  - if the straight jump is blocked by a wall or the board edge, the diagonal
   *    sidesteps around the opponent instead.
   */
  private legalDestinations(
    start: BoardCell,
    opponentCell: BoardCell | undefined,
    blockedEdges: Set<string>
  ): BoardCell[] {
    const directions = [ONE_UP_OFFSET, ONE_DOWN_OFFSET, ONE_LEFT_OFFSET, ONE_RIGHT_OFFSET]
    const destinations: BoardCell[] = []

    for (const direction of directions) {
      const neighbour = this.tryStep(start, direction, blockedEdges)
      if (!neighbour) {
        continue
      }
      if (!opponentCell || !samePosition(neighbour, opponentCell)) {
        destinations.push(neighbour)
        continue
      }
      // The neighbour is the opponent: attempt a straight jump over them.
      const straightLanding = this.tryStep(neighbour, direction, blockedEdges)
      if (straightLanding) {
        destinations.push(straightLanding)
        continue
      }
      // Straight jump blocked by a wall or the edge: allow diagonal sidesteps.
      for (const sideways of perpendicularOffsets(direction)) {
        const diagonalLanding = this.tryStep(neighbour, sideways, blockedEdges)
        if (diagonalLanding) {
          destinations.push(diagonalLanding)
        }
      }
    }
    return destinations
  }

  /**
   * A barricade may never completely seal off either player from their goal
   * row. We build the blocked-edge set from the walls already on the board PLUS
   * the wall this move wants to place, then confirm that every player can still
   * reach their goal. Returns true when the move keeps the board solvable.
   */
  isPieceHavePathToWin(gameState: GameState, move: Move): boolean {
    const walls = [...gameState.getBoard().getWalls()]
    const candidateWall = move.getWall()
    if (candidateWall) {
      walls.push(candidateWall)
    }
    const blockedEdges = buildBlockedEdges(walls)

    return gameState.getPlayers().every(player =>
      this.hasPathToGoal(player.getPiece(), blockedEdges)
    )
  }

  /**
   * Whether the piece can still reach its goal row given the blocked edges. A
   * pawn is solvable exactly when it has a finite shortest path, so this defers
   * to shortestPathToGoal rather than duplicating the search.
   */
  private hasPathToGoal(piece: Piece, blockedEdges: Set<string>): boolean {
    return shortestPathToGoal(piece, blockedEdges) !== null
  }
}