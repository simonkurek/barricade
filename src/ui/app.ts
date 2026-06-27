import {
  BoardCell,
  BOARD_SIZE,
  GameState,
  Move,
  MoveType,
  PieceColor,
  Wall,
  WallOrientation,
  type Player,
} from "../core/game-manager.ts";
import { Engine } from "../core/engine/simulation.engine.ts";
import { createInitialGameState } from "../core/factory.ts";
import { DEFAULT_SEARCH_DEPTH, findBestMove } from "../core/engine/search.ts";

// Geometry — must mirror the CSS custom properties in index.html.
const CELL = 54;
const GAP = 12;
const PAD = 12;
const N = BOARD_SIZE;
const offset = (i: number): number => PAD + i * (CELL + GAP);

type Mode = "MOVE" | "WALL_H" | "WALL_V";

/**
 * A replayable description of a single turn. We never clone GameState (the
 * engine mutates in place); instead we keep the list of descriptors and rebuild
 * the position from the initial state whenever we need to undo. Cheap, and it
 * keeps the rules engine as the single source of truth for every transition.
 */
type Descriptor =
  | { kind: "cell"; x: number; y: number }
  | { kind: "wall"; x: number; y: number; orientation: "HORIZONTAL" | "VERTICAL" };

// Fixed identities: RED is p1 (moves first), BLUE is p2 — see factory.ts.
const RED_ID = "p1";
const BLUE_ID = "p2";

const engine = new Engine();
let history: Descriptor[] = [];
let state: GameState = createInitialGameState();
let mode: Mode = "MOVE";

// --- setup / orientation state ---------------------------------------------
let humanColor: PieceColor = PieceColor.RED; // which side the human controls
let botEnabled = false;
let botDepth = DEFAULT_SEARCH_DEPTH;
let flipped = false; // board orientation: false = RED at bottom, true = BLUE at bottom
let thinking = false; // true while the bot's (blocking) search is running

/** The player id the bot controls — always the side the human is not playing. */
const botPlayerId = (): string => (humanColor === PieceColor.RED ? BLUE_ID : RED_ID);

const boardEl = document.getElementById("board") as HTMLDivElement;
const ranksEl = document.getElementById("ranks") as HTMLDivElement;
const filesEl = document.getElementById("files") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const bannerEl = document.getElementById("banner") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const thinkingEl = document.getElementById("thinking") as HTMLSpanElement;

const columnLetter = (x: number): string => String.fromCharCode("a".charCodeAt(0) + x);
const rowNumber = (y: number): number => BOARD_SIZE - y;

const moveCode = (desc: Descriptor): string =>
  desc.kind === "cell"
    ? `${columnLetter(desc.x)}${rowNumber(desc.y)}`
    : `${desc.orientation === "HORIZONTAL" ? "h" : "v"}${columnLetter(desc.x)}${rowNumber(desc.y)}`;

// ---- coordinate transforms (board <-> screen) -----------------------------
// When `flipped`, the board is shown rotated 180°. A cell at board (x, y) maps
// to display (N-1-x, N-1-y). A wall spans two cells, so under rotation its
// far end becomes the new anchor: board (x, y) -> display anchor (N-2-x, N-2-y).
const dispCol = (x: number): number => (flipped ? N - 1 - x : x);
const dispRow = (y: number): number => (flipped ? N - 1 - y : y);
const wallAnchorX = (x: number): number => (flipped ? N - 2 - x : x);
const wallAnchorY = (y: number): number => (flipped ? N - 2 - y : y);

/** Turns a descriptor into a Move bound to whoever is on turn in `state`. */
const toMove = (desc: Descriptor): Move => {
  const player = state.getCurrentPlayer();
  if (desc.kind === "cell") {
    return new Move(player, new BoardCell(desc.x, desc.y));
  }
  return new Move(
    player,
    undefined,
    new Wall(new BoardCell(desc.x, desc.y), new WallOrientation(desc.orientation))
  );
};

/** Replays the descriptor history onto a fresh initial state. */
const rebuild = (): void => {
  state = createInitialGameState();
  for (const desc of history) {
    const move = toMove(desc);
    if (!engine.isLegalMove(state, move)) {
      throw new Error(`Replayed an illegal move: ${moveCode(desc)}`);
    }
    state.transform(move);
  }
};

/** Commits a turn: append it, replay to the new position, redraw. */
const commit = (desc: Descriptor): void => {
  history.push(desc);
  rebuild();
  render();
};

const descriptorFromMove = (move: Move): Descriptor => {
  if (move.getMoveType() === MoveType.CELL) {
    const cell = move.getCell()!;
    return { kind: "cell", x: cell.getX(), y: cell.getY() };
  }
  const wall = move.getWall()!;
  return {
    kind: "wall",
    x: wall.getPosition().getX(),
    y: wall.getPosition().getY(),
    orientation: wall.getOrientation().getOrientation(),
  };
};

const isBotTurn = (): boolean =>
  botEnabled && !engine.isWinningState(state) && state.getCurrentPlayer().getId() === botPlayerId();

/**
 * If it is the bot's turn, run the search and play its move. The search is
 * synchronous and can take up to ~1s at higher depths, so we flip `thinking`,
 * render the disabled "thinking…" state, then defer the actual search to a
 * macrotask so the browser paints first. The bot controls only one side, so it
 * never needs to chain into a second move.
 */
const scheduleBot = (): void => {
  if (!isBotTurn()) return;
  thinking = true;
  render();
  setTimeout(() => {
    const { move } = findBestMove(engine, state, botDepth);
    thinking = false;
    if (move) {
      commit(descriptorFromMove(move));
    } else {
      render();
    }
  }, 30);
};

/** A move chosen by the human via the board; ignored while the bot is thinking. */
const playHuman = (desc: Descriptor): void => {
  if (thinking) return;
  commit(desc);
  scheduleBot();
};

/** Starts a fresh game from the current setup (color/bot), then lets the bot open if needed. */
const newGame = (): void => {
  history = [];
  rebuild();
  render();
  scheduleBot(); // bot may be on the move first (e.g. human plays BLUE)
};

// ---- rendering ------------------------------------------------------------

const wallBar = (
  anchorX: number,
  anchorY: number,
  horizontal: boolean,
  className: string,
  onClick?: () => void
): HTMLDivElement => {
  const el = document.createElement("div");
  el.className = className;
  if (horizontal) {
    el.style.left = `${offset(anchorX)}px`;
    el.style.top = `${offset(anchorY) + CELL}px`;
    el.style.width = `${2 * CELL + GAP}px`;
    el.style.height = `${GAP}px`;
  } else {
    el.style.left = `${offset(anchorX) + CELL}px`;
    el.style.top = `${offset(anchorY)}px`;
    el.style.width = `${GAP}px`;
    el.style.height = `${2 * CELL + GAP}px`;
  }
  if (onClick) el.addEventListener("click", onClick);
  return el;
};

const renderCoordinates = (): void => {
  ranksEl.innerHTML = "";
  filesEl.innerHTML = "";
  for (let row = 0; row < N; row++) {
    const y = flipped ? N - 1 - row : row;
    const d = document.createElement("div");
    d.textContent = String(rowNumber(y));
    ranksEl.appendChild(d);
  }
  for (let col = 0; col < N; col++) {
    const x = flipped ? N - 1 - col : col;
    const d = document.createElement("div");
    d.textContent = columnLetter(x);
    filesEl.appendChild(d);
  }
};

const render = (): void => {
  boardEl.innerHTML = "";
  renderCoordinates();

  const winner = engine.getWinner(state);
  const pieces = state.getPlayers().map((p) => p.getPiece());
  const current = state.getCurrentPlayer();
  // The board is only clickable when the game is live and the bot is not mid-move.
  const interactive = !winner && !thinking && !isBotTurn();

  // Legal piece destinations for the current player (engine-driven).
  const legalCells = new Map<string, Descriptor>();
  if (interactive && mode === "MOVE") {
    for (const move of engine.calculatePossibleMovesForPiece(state, current.getPiece())) {
      const cell = move.getCell()!;
      legalCells.set(`${cell.getX()},${cell.getY()}`, {
        kind: "cell",
        x: cell.getX(),
        y: cell.getY(),
      });
    }
  }

  // Cells, in display order so the CSS grid fills top-left to bottom-right.
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const x = flipped ? N - 1 - col : col;
      const y = flipped ? N - 1 - row : row;

      const cell = document.createElement("div");
      cell.className = "cell";
      if ((x + y) % 2 === 1) cell.classList.add("dark");
      if (y === 0) cell.classList.add("goal-red");
      if (y === BOARD_SIZE - 1) cell.classList.add("goal-blue");

      const occupant = pieces.find(
        (p) => p.getPosition().getX() === x && p.getPosition().getY() === y
      );
      if (occupant) {
        const pawn = document.createElement("div");
        pawn.className = `pawn ${occupant.getColor()}`;
        if (occupant.getColor() === humanColor) pawn.classList.add("you");
        cell.appendChild(pawn);
      }

      const legal = legalCells.get(`${x},${y}`);
      if (legal) {
        cell.classList.add("legal");
        cell.addEventListener("click", () => playHuman(legal));
      }
      boardEl.appendChild(cell);
    }
  }

  // Placed walls.
  for (const wall of state.getBoard().getWalls()) {
    const horizontal = wall.getOrientation().equals(WallOrientation.HORIZONTAL);
    boardEl.appendChild(
      wallBar(
        wallAnchorX(wall.getPosition().getX()),
        wallAnchorY(wall.getPosition().getY()),
        horizontal,
        "wall"
      )
    );
  }

  // Ghost (legal) wall placements for the selected orientation.
  if (interactive && (mode === "WALL_H" || mode === "WALL_V")) {
    const wantHorizontal = mode === "WALL_H";
    for (const move of engine.calculatePossibleMovesForWalls(state)) {
      const wall = move.getWall()!;
      if (wall.getOrientation().equals(WallOrientation.HORIZONTAL) !== wantHorizontal) continue;
      const wx = wall.getPosition().getX();
      const wy = wall.getPosition().getY();
      boardEl.appendChild(
        wallBar(wallAnchorX(wx), wallAnchorY(wy), wantHorizontal, "wall-ghost", () =>
          playHuman({
            kind: "wall",
            x: wx,
            y: wy,
            orientation: wantHorizontal ? "HORIZONTAL" : "VERTICAL",
          })
        )
      );
    }
  }

  thinkingEl.textContent = thinking ? "Bot is thinking…" : "";
  renderStatus(winner);
  renderLog();
};

const renderStatus = (winner: Player | null): void => {
  if (winner) {
    const who = winner.getId() === botPlayerId() && botEnabled ? "Bot" : "You";
    bannerEl.textContent =
      winner.getPiece().getColor() === humanColor && !botEnabled
        ? `${winner.getName()} wins!`
        : `${who} win${who === "You" ? "" : "s"} — ${winner.getName()}!`;
  } else {
    bannerEl.textContent = "";
  }

  const current = state.getCurrentPlayer();
  statusEl.innerHTML = state
    .getPlayers()
    .map((p) => {
      const color = p.getPiece().getColor();
      const isCurrent = !winner && p.getId() === current.getId();
      const isBot = botEnabled && p.getId() === botPlayerId();
      const isYou = color === humanColor;

      const tags: string[] = [];
      if (isYou) tags.push(`<span class="tag">you</span>`);
      if (isBot) tags.push(`<span class="tag">bot</span>`);

      return `
        <div class="pcard${isCurrent ? " active" : ""}">
          <span class="dot ${color}"></span>
          <div>
            <div class="name">${p.getName()}</div>
            <div class="tags">${tags.join("")}</div>
          </div>
          ${
            isCurrent
              ? `<span class="turn">on turn ◀</span>`
              : `<div class="meta"><div class="walls">${p.getAvailableWalls()}</div><div class="walls-lbl">walls</div></div>`
          }
        </div>`;
    })
    .join("");
};

const renderLog = (): void => {
  const rows: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const num = i / 2 + 1;
    const white = moveCode(history[i]!);
    const black = i + 1 < history.length ? moveCode(history[i + 1]!) : "";
    rows.push(
      `<div class="turn-row"><span class="num">${num}.</span><span class="ply">${white}</span><span class="ply">${black}</span></div>`
    );
  }
  logEl.innerHTML = rows.join("");
  logEl.scrollTop = logEl.scrollHeight;
};

// ---- controls -------------------------------------------------------------

/** Sync the setup buttons/labels with current state (color, bot). */
const syncSetupUI = (): void => {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#color-seg button[data-color]")) {
    btn.classList.toggle("active", btn.dataset.color === humanColor);
  }
};

// Action mode (Move / Wall ─ / Wall │).
for (const btn of document.querySelectorAll<HTMLButtonElement>("#mode-seg button[data-mode]")) {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode as Mode;
    for (const other of document.querySelectorAll("#mode-seg button[data-mode]")) {
      other.classList.toggle("active", other === btn);
    }
    render();
  });
}

// Choose which color the human plays. This redefines who the bot is, so it
// starts a fresh game and auto-orients the board to the chosen side's view.
for (const btn of document.querySelectorAll<HTMLButtonElement>("#color-seg button[data-color]")) {
  btn.addEventListener("click", () => {
    if (thinking) return;
    humanColor = btn.dataset.color as PieceColor;
    flipped = humanColor === PieceColor.BLUE; // put the human's home row at the bottom
    syncSetupUI();
    newGame();
  });
}

document.getElementById("rotate")!.addEventListener("click", () => {
  flipped = !flipped;
  render();
});

document.getElementById("undo")!.addEventListener("click", () => {
  if (thinking || history.length === 0) return;
  history.pop();
  rebuild();
  // With the bot on, the last move was its auto-reply — also take back the
  // human move before it, so undo lands back on the human's turn.
  if (botEnabled && history.length > 0 && state.getCurrentPlayer().getId() === botPlayerId()) {
    history.pop();
    rebuild();
  }
  render();
});

document.getElementById("reset")!.addEventListener("click", () => {
  if (thinking) return;
  newGame();
});

const botToggle = document.getElementById("bot-toggle") as HTMLInputElement;
botToggle.addEventListener("change", () => {
  botEnabled = botToggle.checked;
  render(); // reflect the "(bot)" label
  scheduleBot(); // in case it is already the bot's turn
});

const botDepthEl = document.getElementById("bot-depth") as HTMLSelectElement;
botDepthEl.addEventListener("change", () => {
  botDepth = Number(botDepthEl.value);
});

syncSetupUI();
render();
