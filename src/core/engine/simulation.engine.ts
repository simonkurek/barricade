import { BOARD_SIZE, BoardCell, GameState, LENGTH_OF_WALL, Move, MoveType, Piece, PositionOffset, Wall, WallOrientation } from "../game-manager";

export enum MovementAxis {
  X = "X",
  Y = "Y"
}

export enum MovementDirection {
  LEFT = "LEFT",
  RIGHT = "RIGHT",
  UP = "UP",
  DOWN = "DOWN"
}

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

export class Engine {

  public calculatePossibleMoves(gameState: GameState): Move[] {
    return [
      ...this.calculatePossibleMovesForPiece(gameState, gameState.getCurrentPlayer().getPiece()),
      ...this.calculatePossibleMovesForWalls(gameState)
    ]
  }

  public calculatePossibleMovesForPiece(gameState: GameState, piece: Piece): Move[] {
    const pieceLocation = piece.getPosition()

    const potentialMoves = [
      tryToTransform(pieceLocation, ONE_DOWN_OFFSET),
      tryToTransform(pieceLocation, ONE_UP_OFFSET),
      tryToTransform(pieceLocation, ONE_RIGHT_OFFSET),
      tryToTransform(pieceLocation, ONE_LEFT_OFFSET),
    ].filter(transformationResult => transformationResult.status === OperationResultStatus.SUCCESS)
      .map(transformationResult => transformationResult.transformed)
      .map(targetCell => new Move(gameState.getCurrentPlayer(), targetCell))
      .filter(potentialMove => this.isLegalMove(gameState, potentialMove))

    return potentialMoves;
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

  private validateWallMove(gameState: GameState, move: Move): boolean {
    if (!(gameState.getCurrentPlayer().getAvailableWalls() > 0)){
      return false
    }
    return !!gameState.getBoard().getWalls().filter((wall) => {
      const newWall = move.getWall()!
      const newWallPosition = newWall.getPosition()
      if (
        wall.getPosition().getX() === newWallPosition.getX() &&
        wall.getPosition().getY() === newWallPosition.getY()
      ) {
        return false
      }

      if(!newWall.getOrientation().equals(wall.getOrientation())) return true

      if (newWall.getOrientation().equals(WallOrientation.HORIZONTAL)){
        if (
            wall.getPosition().getX() + 1 === newWallPosition.getX() ||
            wall.getPosition().getX() - 1 === newWallPosition.getX()
          ) {
            return false
        }
      }

      if (newWall.getOrientation().equals(WallOrientation.VERTICAL)){
        if (
            wall.getPosition().getY() + 1 === newWallPosition.getY() ||
            wall.getPosition().getY() - 1 === newWallPosition.getY()
          ) {
            return false
        }
      }
    });
  }
  
  private validatePieceMove(gameState: GameState, move: Move): boolean {
    const targetCell = move.getTarget() as BoardCell;
    const startCell = gameState.getCurrentPlayer().getPiece().getPosition()
    const xVector = targetCell.getX() - startCell.getX();
    const yVector = targetCell.getY() - startCell.getY();
    if ((xVector ^ yVector) !== 1 || (xVector === 1 || yVector === 1)){
      return false;
    }
    const movementAxis = xVector > 0 ? MovementAxis.X : MovementAxis.Y
    let movementDirection: MovementDirection
    if (movementAxis === MovementAxis.X) {
      movementDirection = xVector > 0 ? MovementDirection.RIGHT : MovementDirection.LEFT
    } else {
      movementDirection = yVector > 0 ? MovementDirection.DOWN : MovementDirection.UP
    }
    // improve implementing stategized offset vector
    if (movementDirection === MovementDirection.RIGHT){
      const conflictingWalls = !!gameState.getBoard().getWalls().filter(wall => 
        wall.getOrientation().equals(WallOrientation.VERTICAL) && 
        wall.getPosition().getX() === startCell.getX() &&
        (
          wall.getPosition().getY() === startCell.getY() || 
          wall.getPosition().getY() === startCell.getY() + 1
        )
      ).length
      if (conflictingWalls) return false
    }
    if (movementDirection === MovementDirection.DOWN){
      const conflictingWalls = !!gameState.getBoard().getWalls().filter(wall => 
        wall.getOrientation().equals(WallOrientation.HORIZONTAL) && 
        wall.getPosition().getY() === startCell.getY() &&
        (
          wall.getPosition().getX() === startCell.getX() || 
          wall.getPosition().getX() === startCell.getX() + 1
        )
      ).length
      if (conflictingWalls) return false
    }
    if (movementDirection === MovementDirection.UP){
      const conflictingWalls = !!gameState.getBoard().getWalls().filter(wall => 
        wall.getOrientation().equals(WallOrientation.HORIZONTAL) && 
        wall.getPosition().getY() === startCell.getY() &&
        (
          wall.getPosition().getX() === startCell.getX() || 
          wall.getPosition().getX() === startCell.getX() - 1
        )
      ).length
      if (conflictingWalls) return false
    }
    if (movementDirection === MovementDirection.LEFT){
      const conflictingWalls = !!gameState.getBoard().getWalls().filter(wall => 
        wall.getOrientation().equals(WallOrientation.VERTICAL) && 
        wall.getPosition().getX() === startCell.getX() &&
        (
          wall.getPosition().getY() === startCell.getY() || 
          wall.getPosition().getY() === startCell.getY() - 1
        )
      ).length
      if (conflictingWalls) return false
    }
    return true;
  }
}