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

type Orientation = "HORIZONTAL" | "VERTICAL";

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

// --- wall drag-and-drop state ----------------------------------------------
// While a wall chip is being dragged we paint the legal slots for its
// orientation and track which one the pointer is nearest to.
let dragOrientation: Orientation | null = null;
let hoverWallKey: string | null = null;
// Legal slots painted during a drag: screen-space centre + how to place it.
let ghostSlots: { cx: number; cy: number; key: string; desc: Descriptor }[] = [];
const ghostEls = new Map<string, HTMLDivElement>();

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
const trayEl = document.getElementById("wall-tray") as HTMLDivElement;
const wallHeadEl = document.getElementById("wall-head") as HTMLDivElement;
const wallHintEl = document.getElementById("wall-hint") as HTMLDivElement;

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

  // Legal piece destinations for the current player (engine-driven). Hidden
  // while dragging a wall so the board isn't cluttered with both at once.
  const legalCells = new Map<string, Descriptor>();
  if (interactive && !dragOrientation) {
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

  // Ghost (legal) wall slots for the orientation currently being dragged.
  ghostSlots = [];
  ghostEls.clear();
  if (interactive && dragOrientation) {
    const wantHorizontal = dragOrientation === "HORIZONTAL";
    for (const move of engine.calculatePossibleMovesForWalls(state)) {
      const wall = move.getWall()!;
      if (wall.getOrientation().equals(WallOrientation.HORIZONTAL) !== wantHorizontal) continue;
      const wx = wall.getPosition().getX();
      const wy = wall.getPosition().getY();
      const ax = wallAnchorX(wx);
      const ay = wallAnchorY(wy);
      const key = `${wx},${wy}`;
      const desc: Descriptor = { kind: "wall", x: wx, y: wy, orientation: dragOrientation };
      const el = wallBar(ax, ay, wantHorizontal, "wall-ghost", () => playHuman(desc));
      if (key === hoverWallKey) el.classList.add("hover");
      // Centre of the slot in board (screen) space, for nearest-slot hit testing.
      const cx = offset(ax) + CELL + GAP / 2;
      const cy = offset(ay) + CELL + GAP / 2;
      ghostSlots.push({ cx, cy, key, desc });
      ghostEls.set(key, el);
      boardEl.appendChild(el);
    }
  }

  thinkingEl.textContent = thinking ? "Bot is thinking…" : "";
  renderTray(interactive);
  renderStatus(winner);
  renderLog();
};

/** Renders the draggable wall chips for the player on the move. */
const renderTray = (interactive: boolean): void => {
  const player = state.getCurrentPlayer();
  const remaining = player.getAvailableWalls();
  const canDrag = interactive && remaining > 0;

  wallHeadEl.textContent = `Walls — ${remaining} left`;
  wallHintEl.textContent = dragOrientation
    ? "Drop on a highlighted slot to place"
    : canDrag
      ? "Drag a wall onto the board · click a dot to move"
      : remaining === 0
        ? "No walls remaining"
        : "Click a dot to move";

  // Don't rebuild the chips mid-drag — that would destroy the drag source and
  // swallow the dragend event, leaving the drag state stuck.
  if (dragOrientation) return;

  trayEl.innerHTML = "";
  for (const orientation of ["HORIZONTAL", "VERTICAL"] as const) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.draggable = canDrag;
    if (!canDrag) chip.setAttribute("aria-disabled", "true");

    const bar = document.createElement("div");
    bar.className = `bar ${orientation === "HORIZONTAL" ? "h" : "v"}`;
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.textContent = orientation === "HORIZONTAL" ? "Horizontal" : "Vertical";
    chip.append(bar, lab);

    chip.addEventListener("dragstart", (e) => {
      if (!canDrag) return;
      dragOrientation = orientation;
      hoverWallKey = null;
      e.dataTransfer?.setData("text/plain", orientation);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      chip.classList.add("dragging");
      render(); // paint the legal slots
    });
    chip.addEventListener("dragend", () => {
      dragOrientation = null;
      hoverWallKey = null;
      render();
    });

    trayEl.appendChild(chip);
  }
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
      if (isCurrent) tags.push(`<span class="tag on">on turn</span>`);

      return `
        <div class="pcard${isCurrent ? " active" : ""}">
          <span class="dot ${color}"></span>
          <div>
            <div class="name">${p.getName()}</div>
            <div class="tags">${tags.join("")}</div>
          </div>
          <div class="meta">
            <div class="walls">${p.getAvailableWalls()}</div>
            <div class="walls-lbl">walls</div>
          </div>
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

// Wall drag-and-drop: while a chip is dragged over the board we snap to the
// nearest legal slot and highlight it; dropping places the wall there.
boardEl.addEventListener("dragover", (e) => {
  if (!dragOrientation || ghostSlots.length === 0) return;
  e.preventDefault(); // required to allow a drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";

  const rect = boardEl.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  let nearest: string | null = null;
  let best = Infinity;
  for (const slot of ghostSlots) {
    const d = (slot.cx - px) ** 2 + (slot.cy - py) ** 2;
    if (d < best) {
      best = d;
      nearest = slot.key;
    }
  }
  if (nearest !== hoverWallKey) {
    // Light-touch update: just move the .hover class, no full re-render.
    if (hoverWallKey) ghostEls.get(hoverWallKey)?.classList.remove("hover");
    if (nearest) ghostEls.get(nearest)?.classList.add("hover");
    hoverWallKey = nearest;
  }
});

boardEl.addEventListener("drop", (e) => {
  if (!dragOrientation || !hoverWallKey) return;
  e.preventDefault();
  const slot = ghostSlots.find((s) => s.key === hoverWallKey);
  dragOrientation = null;
  hoverWallKey = null;
  if (slot) playHuman(slot.desc);
  else render();
});

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
