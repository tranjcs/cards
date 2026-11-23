# Cards (Old Maid)

A real-time multiplayer card game played with a standard 52-card deck, built with Node.js,
Express and Socket.IO. The first game is **Old Maid**.

## Run

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 in two or more browser tabs. Use `npm run dev` to restart on file changes.

### Configuration

| Variable          | Default   | Description                                                  |
| ----------------- | --------- | ------------------------------------------------------------ |
| `PORT`            | `3000`    | HTTP port                                                    |
| `TURN_TIMEOUT_MS` | `30000`   | Time per turn; when it runs out a random card is drawn for you |
| `HOST_KICK_VOTES` | `5`       | Minimum guest votes needed to kick the host                  |
| `IDLE_TIMEOUT_MS` | `1200000` | Disconnect a client with no activity for this long (20 min)  |

## How it works

### Phase 1: joining

Everyone who opens the site joins the same room and gets a name like **Player 3** (kept per
browser tab, so a reconnecting tab gets its name back).

- The **first** person in is the **host**; everyone else is a **guest**.
- The **host** decides:
  - when to start the game (at least 2 players),
  - how many cards each player is dealt (or "all cards", the classic deal),
  - and can **kick** any player, before or during a game.
- **Guests** can vote to kick the host. It takes at least **5 votes** (`HOST_KICK_VOTES`);
  a guest can withdraw their vote. When the host leaves or is voted out, the guest who has
  been connected longest becomes host, and the votes reset.

### Phase 2: dealing and playing

Everyone in the room when the host presses **Start** is dealt in (up to 10 players); anyone
joining later watches until the next game.

Old Maid rules as implemented:

1. The Q♣ is removed from the 52-card deck, so one queen can never be paired: the **Old Maid**.
2. The deck is shuffled, a **random player starts**, and cards are dealt one at a time
   **clockwise** from them. Cards not dealt form the **draw pile**.
3. Pairs (two cards of the same rank) are discarded to the **discard pile** automatically.
4. On your turn, take one face-down card from the next player clockwise who still has cards,
   **or** draw the top card of the draw pile. Any pair it makes is discarded, and play passes
   clockwise.
5. Once the draw pile is empty, players with no cards are **safe**. The last player holding a
   card, the Old Maid, loses.

If a player leaves mid-game, their cards go to the next player clockwise. The server is
authoritative: it validates every action, and each client only ever receives its own hand
(other players' cards are sent as counts).

## Project structure

```
src/
  index.js               Entry point: starts the server, handles graceful shutdown
  app.js                 Express + Socket.IO wiring (maps client events to Room methods)
  config.js              Environment-based configuration
  constants.js           Shared enums: phases, kick reasons, event names
  errors.js              ActionError: a rejected player action with a safe message
  random.js              Injectable randomness (crypto by default), Fisher-Yates shuffle
  cards/
    Card.js              Immutable playing card, suits and ranks
    Pile.js              Ordered stack of cards (draw pile, discard pile)
    Deck.js              Standard 52-card deck (a Pile)
    Hand.js              A player's cards; finds and removes pairs
  game/
    CardGame.js          Base class: seats, random first player, clockwise turns, piles, log
    OldMaidGame.js       Old Maid rules (extends CardGame)
    TurnOrder.js         Clockwise seating and whose turn it is
    GameSettings.js      Host-chosen options (immutable)
  room/
    Room.js              Host/guests, settings, kicks, host vote, turn timer, per-player views
    Player.js            A connected player
    NameAllocator.js     "Player N" names, reclaimable on reconnect
    KickVote.js          Votes to kick the host
public/
  index.html             Game page
  css/style.css          Styles (light/dark, phone layout)
  js/cards.js            Renders playing cards
  js/client.js           Browser client
test/                    Unit tests for every class, plus a Socket.IO integration test
```

The layers only depend downwards: `app` → `room` → `game` → `cards`. Everything below `app`
is plain logic with no networking, and all randomness is injected, so it can be tested
deterministically.

### Adding rules or games

New host options (cards drawn per turn, skips, showing or hiding hands, turning the piles
on or off) belong in `GameSettings` and are read by the game. A different game extends
`CardGame` and implements its actions plus `removePlayer`, `autoPlay` and `viewFor`.

## Development

```bash
npm test       # run all tests
npm run lint   # run ESLint
```

CI runs lint and tests on Node 22 and 24 for every pull request and every push to `main`.
