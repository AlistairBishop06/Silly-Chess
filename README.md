# Chaos Chess

**Chaos Chess is a full-stack multiplayer chess variant where normal chess becomes a live strategy party game.** Players create lobbies, play legal chess on an authoritative server, and periodically draft rule cards that mutate the board, pieces, win conditions, hazards, and even the UI itself.

Live demo: https://chaoschess.onrender.com/

Built as a portfolio project, Chaos Chess combines realtime multiplayer infrastructure, a custom chess engine, account persistence, singleplayer progression, cosmetics, achievements, daily shop rotation, and a canvas-heavy frontend into one playable web app.

## Highlights

- **Realtime 1v1 multiplayer** with public/private lobbies, six-character lobby codes, reconnect support, and Socket.IO state sync.
- **Singleplayer campaign** against Chaos Bot, with level progression and rule unlocks.
- **Authoritative chess engine** with legal move generation, check/checkmate handling, castling, en passant, promotion, replayable state, and server-side validation for every move.
- **88 rule cards** split across instant, delayed, duration, and permanent effects.
- **Rule draft loop** where players periodically choose from random cards and both selected rules apply.
- **Interactive mini-games** including Rock Paper Scissors, Coinflip Wager, Supermarket, Fruit Machine, Mutant fusion, targeted rules, and Pawn Soldier shots.
- **Persistent accounts** with stats, ratings, match history, social lists, achievements, coins, cosmetics, and profile customization.
- **Daily cosmetics shop** with seeded DiceBear avatar themes, profile banners, board skins, piece skins, animated borders, emotes, and card backs.
- **Personalized profile avatars** generated through DiceBear using stable per-user seeds, so every user has a unique avatar in each icon theme.
- **Canvas-first game client** with animated move effects, portals, hazards, shields, overlays, rule popups, modals, confetti, and responsive UI.
- **Admin tools** for user inspection/editing and runtime flag management.
- **Flexible persistence**: local JSON storage for development or PostgreSQL for production.

## Gameplay

Chaos Chess starts from normal chess, then steadily breaks the board in interesting ways.

1. Sign up or log in.
2. Create a public/private lobby, join a friend, or start singleplayer.
3. Play legal chess moves.
4. Every rule draft interval, choose a card before the timer expires.
5. Survive the combined effects, hazards, mini-games, and board mutations.
6. Win by checkmate, rule-specific win conditions, or whatever chaos the match creates.

Example rule effects include:

- Black holes, lava, asteroid debris, plague, missing squares, portals, fans, ice, gravity, and wrap-around movement.
- Piece mutation, temporary queens, titan pieces, mutant fusion, king shields, identity swaps, pawn soldiers, suicide bombers, and secret vital pieces.
- Board-wide events like deleted columns, edge rotation, bishop shuffle, rook mirror, hard reset, soft reset, lawnmower sweeps, and orbital strikes.
- UI and information effects like visual flip, colour blind mode, ads, hidden information, and custom target prompts.

## Core Systems

### Realtime Multiplayer

The multiplayer layer is built on Socket.IO. The server owns all room state, move legality, timers, rule resolution, mini-games, and result recording. Clients send intents; the server replies with accepted state.

Key features:

- Public server browser.
- Private lobby codes.
- Automatic game start when two players join.
- Reconnect and socket rebinding.
- Room cleanup for abandoned sessions.
- Per-player state payloads for private information.
- Server-ticked rule-choice and mini-game timeouts.

### Chess And Rule Engine

The backend separates core chess logic from variant rule lifecycle:

- `ChessEngine.js` handles board representation, legal moves, check rules, castling, en passant, and promotion.
- `Game.js` owns match state, turn progression, player phases, effects, hazards, stats, and sync payloads.
- `RuleManager.js` manages instant, delayed, duration, and permanent rule timing.
- `ruleset.js` contains the 88 rule cards.
- `miniGames.js` handles interactive rule mini-games and modal-driven player choices.

### Accounts And Progression

Accounts are lightweight but full-featured:

- Signup/login/logout with password hashing.
- Bearer-token authenticated API routes.
- Profile settings and public profile pages.
- Stats: wins, losses, draws, rating, peak rating, captures, checkmates, coins, streaks, rule usage, hazard deaths, and more.
- Match history and rule collection tracking.
- Achievements that award coins automatically.
- Friends, rivals, and clubs.
- Singleplayer campaign progress and unlockable rule pools.

### Cosmetics And Shop

Players can earn and spend coins on cosmetics:

- DiceBear icon themes, using stable seeded avatars.
- Profile banners.
- Board skins.
- Piece skins.
- Animated borders.
- Emotes.
- Rule card backs.

The daily shop uses deterministic daily rotation and caps avatar/icon themes to at most one daily offer, keeping the shop varied instead of flooding it with icon cosmetics.

## Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript, Canvas API
- **Realtime:** Socket.IO
- **Backend:** Node.js, Express
- **Persistence:** JSON file store for local development, optional PostgreSQL via `pg`
- **Avatar generation:** DiceBear `@dicebear/core` and `@dicebear/collection`
- **Architecture:** Authoritative server with client-side rendering and optimistic UI only where safe

## Run Locally

Prerequisites:

- Node.js 18+
- npm

Install and start:

```powershell
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Development uses the same entry point:

```powershell
npm run dev
```

Tests:

```powershell
npm test
```

Note: the current test script is a placeholder, but the codebase is organized so engine, rule, and account tests can be added cleanly.

## Configuration

The server reads `.env` first, then `env`, if present.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port. |
| `DATABASE_URL` | empty | PostgreSQL connection string. If absent, account data is stored in `data/users.json`. |
| `NEON_DATABASE_URL` | empty | Alternate PostgreSQL connection string. |
| `POSTGRES_URL` | empty | Alternate PostgreSQL connection string. |
| `DISABLE_DATABASE` | `false` | Forces JSON storage even if a database URL exists. |
| `DEBUG_MODE` | `true` | Enables debug/runtime behavior used by the app. |
| `RULE_CHOICE_EVERY_PLIES` | `7` | How often rule drafts appear. |
| `RULE_CHOICE_DURATION_MS` | `30000` | Rule draft timer duration in milliseconds. |

Example:

```dotenv
PORT=3000
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
DEBUG_MODE=false
```

## Backend API

Most account routes return JSON shaped like:

```json
{ "ok": true }
```

Errors return:

```json
{ "ok": false, "error": "Message" }
```

Authenticated routes expect:

```http
Authorization: Bearer <session-token>
```

### Public REST Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/rules` | Returns public rule card metadata for the rulebook and campaign UI. |
| `GET` | `/api/avatar/:style.svg?seed=...` | Generates a DiceBear SVG avatar for a supported icon theme and seed. |
| `GET` | `/api/users/:username/profile` | Returns a public profile for another player. |

### Auth REST Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Creates an account, initializes profile/stats/campaign, and returns a token. |
| `POST` | `/api/auth/login` | Authenticates and returns a session token. |
| `POST` | `/api/auth/logout` | Deletes the current session token. |
| `DELETE` | `/api/me` | Deletes the authenticated account and sessions. |

### Account REST Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/me` | Returns the authenticated user, stats, cosmetics, achievements, campaign, and profile. |
| `PATCH` | `/api/me` | Updates username, profile fields, and equipped cosmetics. |
| `PATCH` | `/api/me/password` | Changes password after verifying the current password. |
| `POST` | `/api/me/friends` | Adds a friend by username. |

### Campaign And Shop REST Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/me/campaign` | Returns current singleplayer campaign progress. |
| `PATCH` | `/api/me/campaign` | Resets campaign or opens a campaign chest. |
| `GET` | `/api/shop/daily` | Returns deterministic daily shop offers and reset time. |
| `POST` | `/api/me/shop/buy` | Purchases a daily shop cosmetic with coins. |

### Admin REST Endpoints

Admin routes require an authenticated admin account.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/users` | Lists sanitized user payloads. |
| `PATCH` | `/api/admin/users/:id` | Edits user profile, stats, cosmetics, social data, and selected account fields. |
| `GET` | `/api/admin/flags` | Reads runtime flags. |
| `PATCH` | `/api/admin/flags` | Updates runtime flags, such as debug mode. |

## Realtime Socket API

All game/lobby actions are Socket.IO events. Most client emissions include a callback response:

```js
{ ok: true }
```

or:

```js
{ ok: false, error: "Message" }
```

### Client -> Server Lobby Events

| Event | Payload | Purpose |
| --- | --- | --- |
| `lobby:listOpen` | `{}` | Lists public lobbies. |
| `lobby:create` | `{ authToken, visibility }` | Creates a public/private multiplayer lobby. |
| `lobby:join` | `{ code, authToken }` | Joins a lobby by code. |
| `lobby:singleplayer` | `{ authToken, campaignLevel, rulePoolIds }` | Starts a singleplayer bot match. |
| `lobby:resume` | `{ code, playerId }` | Rebinds a reconnecting socket to a player. |
| `lobby:leave` | `{ code, playerId }` | Leaves and closes a lobby. |

### Client -> Server Game Events

| Event | Payload | Purpose |
| --- | --- | --- |
| `game:sync` | `{ code, playerId }` | Requests current player-specific state. |
| `game:requestMoves` | `{ code, playerId, from }` | Gets legal destinations for a square. |
| `game:move` | `{ code, playerId, from, to, promotion }` | Attempts a chess move. |
| `game:chooseRule` | `{ code, playerId, ruleId }` | Picks a draft rule card. |
| `game:ruleTarget` | `{ code, playerId, square }` | Submits a target square for targeted rules. |
| `game:pawnSoldierShot` | `{ code, playerId, target }` | Fires a Pawn Soldier shot. |
| `game:mutantSelection` | `{ code, playerId, squares }` | Updates selected pieces for Mutant fusion. |
| `game:mutantConfirm` | `{ code, playerId }` | Confirms Mutant fusion. |
| `game:supermarketPurchase` | `{ code, playerId, items }` | Buys pieces during Supermarket. |
| `game:fruitMachineSpin` | `{ code, playerId }` | Spins the Fruit Machine. |
| `game:fruitMachineCollect` | `{ code, playerId }` | Collects Fruit Machine prizes. |
| `game:rpsChoice` | `{ code, playerId, choice }` | Submits rock/paper/scissors. |
| `game:wagerSelection` | `{ code, playerId, squares }` | Selects wagered pieces. |
| `game:wagerConfirm` | `{ code, playerId }` | Confirms Coinflip Wager selection. |
| `game:ready` | `{ code, playerId }` | Toggles rematch readiness. |
| `game:emote` | `{ code, playerId }` | Sends the equipped emote to the room. |

### Server -> Client Events

| Event | Purpose |
| --- | --- |
| `game:state` | Player-specific authoritative game state, including board, phase, rules, effects, and private data where relevant. |
| `game:emote` | Broadcasts a player's equipped emote. |
| `lobby:message` | Lobby status messages such as reconnects/disconnects. |
| `lobby:closed` | Indicates the room closed. |
| `lobby:openServers` | Broadcasts the current public server list. |

## Project Structure

```text
server.js                         Express app, HTTP server, Socket.IO bootstrapping
src/server/accountService.js      Auth, profiles, API routes, shop, campaign, admin
src/server/account/achievements.js
src/server/account/cosmetics.js
src/server/botController.js       Singleplayer bot behavior
src/server/lobby.js               Room code and room model helpers
src/server/matchRecorder.js       Match stats, rating, history, achievements
src/server/realtimeController.js  Socket.IO lobby/game event controller
src/server/game/ChessEngine.js    Core chess rules and legal move generation
src/server/game/Game.js           Match state, phases, effects, rule orchestration
src/server/game/miniGames.js      RPS, wager, supermarket, fruit machine, mutant flows
src/server/game/rules/ruleset.js  Rule card definitions
public/index.html                 UI shell and modals
public/client.js                  Canvas renderer, UI behavior, Socket.IO client
public/style.css                  Responsive styling, themes, animations
public/js/*                       Smaller browser modules for DOM/storage/realtime helpers
data/users.json                   Local fallback persistence
```

## Why This Project Stands Out

Chaos Chess is not a static clone or tutorial app. It demonstrates:

- Designing an authoritative realtime game server.
- Building custom game rules without relying on a third-party chess engine.
- Managing long-lived multiplayer state, reconnects, timers, private player data, and bot games.
- Creating a full account/progression loop around gameplay.
- Integrating generated avatar assets through deterministic seeds.
- Shipping a polished frontend with canvas rendering, modals, animations, responsive layout, and profile/shop systems.

## License

ISC. See `package.json`.
