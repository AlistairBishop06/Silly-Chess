# Chaos Chess (Multiplayer)

A browser-based, multiplayer chess variant where the board is the battlefield and rules arrive as cards.
The server is authoritative (full chess legality and variant logic), and the client is a canvas renderer with board effects and animations.

Live demo: https://chaoschess.onrender.com/

## Features

- Multiplayer lobbies (share a short code, play in two tabs or with a friend).
- Authoritative chess engine: check/checkmate, castling, en passant, promotion (defaults to queen).
- Rule card draft loop: both players choose from random cards and both chosen rules apply.
- Rule types: Instant, Delayed ("in X plies"), and Duration ("for X plies").
- Targeted rules and mini-games (for example RPS Duel and Coinflip Wager).
- Visual-first board: hazards and rule effects are rendered directly on the board with animation.
- Teleporter corners render as portals; teleports animate as a zap.
- Black Hole marks a forming square and later becomes a deadly tile.
- Fans render a prop plus airflow; pushed pieces glide instead of snapping.
- Ice Board adds a frosty overlay; sliding is animated.
- Plague, The Swap, Haunted Board, Sticky Squares, Bumper Board, and Lawnmower add new marked-square and sweep effects.
- Backup Plan adds a secret vital piece with a private heart marker visible only to its owner.
- Gravity and wrap-around rules have persistent overlays.
- Kings show a visible shield aura when shield charges are available.

## How To Play

1. Open the app in two browser windows (or share it with a friend).
2. Create a lobby in the first window and share the lobby code.
3. Join from the second window using the code.
4. Play normal chess moves. When a rule-choice phase appears, pick a card before the timer expires.

Rule timing notes:
- A "ply" is a half-move (one player's move). Timers tick in plies.
- By default, a rule choice happens every 7 plies, and the choice timer is 30 seconds. See Configuration below.

## Run Locally

Prereqs: Node.js 18+ recommended.

```powershell
npm install
npm start
```

Then open `http://localhost:3000`.

Development (same entry point, but keeps intent explicit):

```powershell
npm run dev
```

## Configuration

Environment variables:
- `PORT` (default: `3000`): HTTP port.
- `RULE_CHOICE_EVERY_PLIES` (default: `7`): how often players draft rule cards.
- `RULE_CHOICE_DURATION_MS` (default: `30000`): time window to pick a rule card.
- `DATABASE_URL` (optional): PostgreSQL connection string. If set, account/session/profile data is stored in Postgres instead of `data/users.json`.
- Local env files: the server will read `.env` first, then `env`, if present.

Example PowerShell session:

```powershell
$env:DATABASE_URL="postgresql://user:password@host/db?sslmode=require"
npm start
```

Example `.env` or `env` file:

```dotenv
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
PORT=3000
```

## Project Structure

- `server.js`: Express + Socket.IO server, lobby management, and HTTP routes.
- `src/server/game/ChessEngine.js`: move generation + legality (including check).
- `src/server/game/Game.js`: authoritative match state, turn progression, effects, and sync payloads.
- `src/server/game/rules/RuleManager.js`: rule lifecycle (instant/delayed/duration/permanent).
- `src/server/game/rules/ruleset.js`: the rules themselves.
- `public/index.html`: client UI scaffold.
- `public/client.js`: canvas renderer, interaction, effects/animations, and UI wiring.
- `public/style.css`: styling.

## License

ISC (see `package.json`).
