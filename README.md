# Chaos Chess (Multiplayer)

Browser-based multiplayer chess variant with rule cards.

## Run

```powershell
npm start
```

Then open `http://localhost:3000` in two browser windows:

1. Create a lobby in the first window → share the 6-char code
2. Join from the second window using the code

## Gameplay

- Standard chess rules (legal move validation server-side): check/checkmate, castling, en passant, promotion (defaults to Queen).
- Every **3 combined turns (plies)**, both players get **3 random rule cards** → each picks **1** → both rules apply.
- Rules can be **Instant**, **In X Turns**, or **For X Turns** (timers tick in plies).

## Project layout

- `server.js` — Express + Socket.io server
- `src/server/game/ChessEngine.js` — chess legality + move generation
- `src/server/game/Game.js` — authoritative room/game state + sync
- `src/server/game/rules/` — rule definitions + rule manager
- `public/` — HTML/CSS/Canvas client

