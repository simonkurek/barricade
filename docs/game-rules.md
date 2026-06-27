# Barricade — Game Context & Rules

Reference implementation of **Barricade** (a Quoridor-style abstract strategy game),
based on the official rules at <https://barricade.gg/rules>.

This document is the source of truth for *what the game is*. It also maps the rules to
the terminology used in the codebase (`src/`) so the engine and the rules stay in sync.

---

## Overview

Barricade is a **2-player** strategy game played on a **9×9 grid**. Each player races
their single piece (a "pawn") to the opposite side of the board, while placing
**barricades** (called **walls** in the code) to slow the opponent down.

- Player 1 starts on the center square of their back row and races toward the far row.
- Player 2 starts on the center square of the opposite back row and races back.
- The first player to reach **any** square on their goal row wins.

## Setup

- Board: 9×9 grid of cells.
- Each player's piece starts on the **center square** of their own back row (column `e`).
- Each player is given **10 barricades** to place over the course of the game.
- Player 1 moves first; players then alternate.

## Turn structure

On each turn a player must perform **exactly one** action — turns cannot be skipped:

1. **Move** their piece one square, **or**
2. **Place a barricade**.

Players alternate until someone reaches the opposite side.

## Movement

- A piece moves **one square up, down, left, or right** — no diagonals.
- A piece **cannot** pass through a barricade or off a board edge.
- **Jumping:** when a piece is directly adjacent to the opponent's piece, it may **leap
  over** the opponent to the square immediately behind them.
- **Diagonal jump:** if a barricade (or the board edge) is directly behind the opponent,
  blocking the straight leap, the piece may instead move **diagonally** to a square
  beside the opponent.

## Barricades (walls)

- A barricade spans **two squares**, placed either **horizontally** or **vertically**
  in the grooves *between* cells.
- Barricades **block both players equally**.
- Barricades **cannot overlap**, and one **cannot cross through the middle** of another.
- **Path guarantee:** a barricade may **never completely cut off** either player's path
  to their goal row. A placement that would seal off a player has to be rejected.
- Each player has a finite supply (**10**); once spent, that player can only move.

## Win conditions

A player wins when any of the following happens:

- Their piece reaches **any square on the opposite side** of the board (their goal row).
- The opponent **resigns**.
- The opponent **times out**.

---

## Mapping to the codebase

The code in `src/` models the rules above. Key terms:

| Rule concept        | Code symbol                                       |
| ------------------- | ------------------------------------------------- |
| Board (9×9)         | `Board`, `BOARD_SIZE = 9`                         |
| A barricade / wall  | `Wall` (length `LENGTH_OF_WALL = 2`)              |
| Wall direction      | `WallOrientation` (`HORIZONTAL` / `VERTICAL`)     |
| A grid square       | `BoardCell` (`x`, `y`)                            |
| A player's pawn     | `Piece` (color `RED` / `BLUE`)                    |
| One turn's action   | `Move` (`MoveType.CELL` or `MoveType.WALL`)       |
| Full game state     | `GameState`                                       |
| Rules / legality    | `Engine` (`simulation.engine.ts`)                 |

### Coordinates

`BoardCell` uses `(x, y)` with the origin at the top-left:

- `x` ∈ `[0, 8]` maps to columns `a`–`i`.
- `y` ∈ `[0, 8]` with **`y = 0` at the top**. Lower `y` is "up".

Movement offsets reflect this: `ONE_UP_OFFSET = (0, -1)`, `ONE_DOWN_OFFSET = (0, +1)`.

### Move notation

`Move.from(player, moveCode)` parses a string move code:

- **Piece move** — 2 chars: `<col><row>`, e.g. `e3` (column `e`, row `3`).
- **Wall placement** — 3 chars: `<orientation><col><row>`, where orientation is
  `h` (horizontal) or `v` (vertical), e.g. `he4`, `vf3`.

Rows are read as `y = BOARD_SIZE - Number(rowChar)`, columns as `x = char - 'a'`.

### Engine responsibilities

`Engine` (`src/core/engine/simulation.engine.ts`) provides:

- `calculatePossibleMoves(state)` — all legal piece moves + legal wall placements.
- `getWinner(state)` / `isWinningState(state)` — detect a finished game: a player
  wins the moment their piece sits on its goal row (`getWinner` returns that player,
  or `null`). Resignation and timeout are out of scope for the engine.
- `isLegalMove(state, move)` — validates a single move.
- `validatePieceMove` — orthogonal step, blocked by edges and walls.
- `validateWallMove` — checks wall supply, overlap/crossing conflicts, and that the
  placement does not seal off a player (`isPieceHavePathToWin`).
- `isPieceHavePathToWin` — enforces the "barricade can't cut off a path" guarantee via
  **BFS**. It builds a blocked-edge set (`buildBlockedEdges`) from the existing walls plus
  the candidate wall, then confirms **every** player can still reach their goal row.

### Wall ↔ edge convention

`buildBlockedEdges` translates each wall into the two board edges (grooves between
cells) it closes:

- **HORIZONTAL** wall at `(x, y)` → blocks the vertical steps in columns `x` and `x+1`
  across the groove between rows `y` and `y+1`.
- **VERTICAL** wall at `(x, y)` → blocks the horizontal steps in rows `y` and `y+1`
  across the groove between columns `x` and `x+1`.

Goal rows: **RED** races to the top row (`y = 0`), **BLUE** to the bottom (`y = 8`),
exposed via `Piece.getGoalRow()`.

### Running tests

The project uses **Bun**. Tests live next to the code as `*.test.ts`:

```sh
bun test                # run the suite
bun run start           # run src/main.ts
./node_modules/.bin/tsc --noEmit   # typecheck
```

### Piece movement & jumping

`legalDestinations(start, opponentCell, blockedEdges)` is the single source of truth for
where a piece may land; both `validatePieceMove` and `calculatePossibleMovesForPiece` use
it. From the piece's cell it yields:

- a plain step into any open, unoccupied orthogonal neighbour;
- when a neighbour holds the **opponent**, a **straight jump** to the cell beyond them (if
  that onward step is open and on-board);
- if the straight jump is blocked by a wall or the board edge, the **diagonal sidesteps**
  around the opponent instead.

All step legality (on-board + groove not walled) flows through `tryStep`, which shares the
`buildBlockedEdges` model — so movement, jumping, and path-finding never disagree.
