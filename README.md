# Cards (Old Maid, Pusoy Dos, Go Fish)

Real-time multiplayer card games played with a standard 52-card deck, built with Node.js,
Express and Socket.IO. The host picks the game: **Old Maid**, **Pusoy Dos** or **Go Fish**.

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
| `TURN_TIMEOUT_MS` | `30000`   | Time per turn; when it runs out a move is made for you (Old Maid: a random draw; Pusoy Dos: pass, or lead your lowest card; Go Fish: ask a random player for a random rank) |
| `HOST_KICK_VOTES` | `5`       | Minimum guest votes needed to kick the host                  |
| `IDLE_TIMEOUT_MS` | `1200000` | Disconnect a client with no activity for this long (20 min)  |
| `MAX_ROOM_SIZE`   | `50`      | Most people in the room at once                              |
| `MAX_CONNECTIONS_PER_IP` | `6` | Most simultaneous connections (tabs) from one IP address; `0` = unlimited |
| `KICK_BAN_MS`     | `300000`  | How long a kicked player's IP can't rejoin (5 min); `0` = no ban |
| `ONE_VOTE_PER_IP` | `true`    | Count host-kick votes once per IP. Set `false` to test votes from several local tabs |
| `TRUSTED_PROXY_HOPS` | `0`    | Proxies in front that append to `X-Forwarded-For` (the deploy script sets `1` on Cloud Run). Keep `0` when clients connect directly, or anyone could fake their IP |

## How it works

### Phase 1: joining

Everyone who opens the site joins the same room and gets a name like **Player 3** (kept per
browser tab, so a reconnecting tab gets its name back).

- The **first** person in is the **host**; everyone else is a **guest**.
- The **host** decides:
  - which game to play (Old Maid, Pusoy Dos or Go Fish),
  - when to start the game (at least 2 players),
  - for Old Maid, how many cards each player is dealt (or "all cards", the classic deal),
  - and can **kick** any player, before or during a game.
- **Guests** can vote to kick the host. It takes at least **5 votes** (`HOST_KICK_VOTES`);
  a guest can withdraw their vote. When the host leaves or is voted out, the guest who has
  been connected longest becomes host, and the votes reset.

### Phase 2: dealing and playing

Everyone in the room when the host presses **Start** is dealt in (up to 10 players for Old Maid
and Go Fish, 4 for Pusoy Dos); anyone else, and anyone joining later, watches until the next game.

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

If a player leaves mid-game, their cards go to the next player clockwise.

Pusoy Dos ("Big Two") rules as implemented:

1. Cards rank **3 (lowest)** up to K, A, **2 (highest)**; suits break ties: ♣ < ♠ < ♥ < ♦.
2. Each player is dealt 13 cards (17 with three players); the rest are set aside face down.
3. Whoever holds the lowest card dealt (the 3♣ with four players) leads, and the first play must
   include that card.
4. A play is a single, a pair, three of a kind, or a five-card hand. Five-card hands rank
   straight < flush < full house < four of a kind (plus any card) < straight flush. Straights run
   from 3-4-5-6-7 to 10-J-Q-K-A (no 2s, no wrapping round). Singles, pairs, straights, flushes
   and straight flushes are compared by their highest card; three of a kind, full houses and four
   of a kind by the rank of the matching cards.
5. Going clockwise, each player beats the table with a higher play of the same number of cards,
   or passes. A player who passed may still play on a later turn. When everyone else passes in a
   row, the last player to play clears the table and leads anything.
6. The first player to get rid of all their cards wins.

Go Fish rules as implemented (full 52-card deck):

1. Each player is dealt 7 cards (5 with four or more players), clockwise from a random first
   player. The rest form the **draw pile** (the pond).
2. On your turn, ask any other player who has cards for a rank you hold. If they have any, they
   hand **all** of them over and you go again.
3. If not, **go fish**: draw from the pile. If you draw the rank you asked for, you show it and go
   again; otherwise play passes clockwise.
4. Four of a kind make a **book**, laid down automatically.
5. A player with no cards draws one at the start of their turn; once the pile is empty too,
   they're out. If nobody else has cards to ask, you just draw from the pile.
6. When all 13 books are made, the player with the most books wins (ties share the win).

Asks and their results are public, as at a real table; a card fished from the pile is only shown
to the player who drew it, unless it's the rank they asked for. If a player leaves, their cards
go to the next player clockwise (their books leave with them); a player who runs out of time
asks a random player for a random rank.

In any game you can arrange your own hand with the **Value / Suit / Free** buttons: by the
game's card order, grouped by suit (♣ ♠ ♥ ♦), or in any order you like by dragging cards (on a
touch screen, press and hold a card first; with a keyboard, Alt + ←/→ moves the focused card).
Dragging switches to Free. The arrangement only exists in your browser tab.

In Pusoy Dos, a player who runs out of time passes (or, when leading, plays their lowest card). If a player
leaves, their cards are set aside; if theirs was the play on the table, the next player leads.

The server is
authoritative: it validates every action, and each client only ever receives its own hand
(other players' cards are sent as counts).

## Security

The server is authoritative and treats everything from clients as untrusted:

- **Hidden information stays hidden.** Each client only receives its own hand; other hands are
  sent as card counts. The card you took is only revealed to you and the player you took it from.
  Shuffles use `crypto`, and picks from another player's face-down cards are random.
- **Input validation.** Every action checks the sender's role and turn and validates its payload;
  bad input gets an error message, never a crash. Messages over 4 KB are refused.
- **Cross-site connections are refused.** WebSockets aren't covered by CORS, so the server checks
  the `Origin` header itself; another website can't make its visitors join (or vote in) the room.
- **Abuse limits.** Room size, connections per IP and messages per client (bursts of 20, then 5 a
  second) are capped. Host-kick votes count once per IP, so one person with many tabs can't vote
  the host out alone. A kicked player's IP is refused for 5 minutes (unless they share the host's IP).
- **Headers.** A strict Content-Security-Policy (no inline or third-party scripts, no framing),
  HSTS, `nosniff`, `Referrer-Policy: no-referrer` and friends.
- **Rendering.** The client only ever sets text with `textContent`; names are server-generated.

Limits worth knowing: IP-based rules treat everyone behind one IP (a household, an office, a phone
carrier's NAT) as one person, and someone with many IP addresses can still get around them. There
are no accounts, so a ban can't follow a person to another network.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Deploy (Google Cloud Run)

| Environment | Google Cloud project   | URL                           |
| ----------- | ---------------------- | ----------------------------- |
| `dev`       | `codebrew-development` | https://cards.steeping.studio |
| `prod`      | `codebrew-production`  | https://cards.codebrew.studio |

The targets live in [`scripts/environments.sh`](scripts/environments.sh). The service runs with
`--max-instances 1` because the room lives in memory, `--min-instances 0` so it costs nothing while
idle, and `TRUSTED_PROXY_HOPS=1` so per-IP limits see the real client address.

Prerequisites: billing enabled on both projects, and the
[gcloud CLI](https://cloud.google.com/sdk/docs/install) logged in (`gcloud auth login`) as an
account that owns them.

### First deploy and domains (once per environment)

1. Deploy from your machine (builds with Cloud Build; production only from a clean `main`):

   ```bash
   ENVIRONMENT=dev ./scripts/deploy-cloudrun.sh
   ENVIRONMENT=prod ./scripts/deploy-cloudrun.sh
   ```

2. Verify each parent domain once with the same Google account (opens Search Console; add the
   `TXT` record it shows at your DNS provider):

   ```bash
   gcloud domains verify steeping.studio
   gcloud domains verify codebrew.studio
   ```

3. Map the domains. The script prints the DNS record to add, normally a `CNAME` from `cards` to
   `ghs.googlehosted.com.`:

   ```bash
   ENVIRONMENT=dev ./scripts/map-domain.sh
   ENVIRONMENT=prod ./scripts/map-domain.sh
   ```

   On Cloudflare, set the record to **DNS only** (grey cloud). If the domain has `CAA` records, they
   must allow `pki.goog` and `letsencrypt.org`. The certificate takes 15 minutes to a few hours;
   rerun the script to check.

### Deploying from GitHub

The **Deploy** workflow (Actions → Deploy → Run workflow) tests the chosen branch, builds the image
and deploys it to the environment you pick. `prod` only accepts `main`. GitHub logs in to Google
with Workload Identity Federation, so no key is stored anywhere.

1. For each environment, create the deploy account and identity provider (safe to rerun):

   ```bash
   ENVIRONMENT=dev ./scripts/setup-github-deploy.sh
   ENVIRONMENT=prod ./scripts/setup-github-deploy.sh
   ```

   Google only accepts tokens from this repository's matching GitHub environment, and for `prod`
   only from `main`.

   To share an existing deploy account (for example tic-tac-toe's `github-deploy`) instead of
   creating `github-deploy-cards`, set `DEPLOY_SA_NAME`:

   ```bash
   DEPLOY_SA_NAME=github-deploy ENVIRONMENT=dev ./scripts/setup-github-deploy.sh
   ```

   The script only adds what cards needs (login from this repo, pushing to the `cards` image
   repository); the other repo's access stays as it is.

2. In GitHub, **Settings → Environments**, create `dev` and `prod`, and add the four secrets each
   script prints (`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`). For `prod`,
   also add **required reviewers** and limit **deployment branches** to `main`.

## Project structure

```
src/
  index.js               Entry point: starts the server, handles graceful shutdown
  app.js                 Express + Socket.IO wiring (maps client events to Room methods)
  config.js              Environment-based configuration
  constants.js           Shared enums: phases, kick reasons, event names
  errors.js              ActionError: a rejected player action with a safe message
  net/
    requests.js          Client IP (proxy-aware), same-origin check, security headers
    RateLimiter.js       Per-client token bucket
    ConnectionLimiter.js Connections per IP address
  random.js              Injectable randomness (crypto by default), Fisher-Yates shuffle
  cards/
    Card.js              Immutable playing card, suits and ranks
    Pile.js              Ordered stack of cards (draw pile, discard pile)
    Deck.js              Standard 52-card deck (a Pile)
    Hand.js              A player's cards, kept sorted; finds and removes pairs and books
  game/
    CardGame.js          Base class: seats, random first player, clockwise turns, piles, log
    OldMaidGame.js       Old Maid rules (extends CardGame)
    PusoyDosGame.js      Pusoy Dos rules (extends CardGame)
    pusoyDosCombos.js    Pusoy Dos card order, play types and which play beats which
    GoFishGame.js        Go Fish rules (extends CardGame)
    games.js             The games the host can choose from
    TurnOrder.js         Clockwise seating and whose turn it is
    GameSettings.js      Host-chosen options (immutable)
  room/
    Room.js              Host/guests, settings, kicks, host vote, turn timer, per-player views
    Player.js            A connected player
    NameAllocator.js     "Player N" names, reclaimable on reconnect
    KickVote.js          Votes to kick the host
scripts/
  environments.sh        dev/prod targets (project, domain, region)
  deploy-cloudrun.sh     Build and deploy to Cloud Run
  map-domain.sh          Point the environment's domain at the service
  setup-github-deploy.sh One-time setup for the GitHub "Deploy" workflow
public/
  index.html             Game page
  css/style.css          Styles (light/dark, phone layout)
  js/cards.js            Renders playing cards
  js/handArranger.js     Arranging your own hand: by value, by suit, or by dragging
  js/client.js           Browser client
test/                    Unit tests for every class, plus a Socket.IO integration test
```

The layers only depend downwards: `app` → `room` → `game` → `cards`. Everything below `app`
is plain logic with no networking, and all randomness is injected, so it can be tested
deterministically.

### Adding rules or games

New host options (cards drawn per turn, skips, showing or hiding hands, turning the piles
on or off) belong in `GameSettings` and are read by the game. A different game extends
`CardGame` and implements its actions plus `removePlayer`, `autoPlay` and `viewFor` (whose
result carries a `type` the client renders by). Register it in `GameSettings` (`GameType`) and
`src/game/games.js`, route its actions through `Room` and `app.js`, and render it in
`public/js/client.js`.

## Development

```bash
npm test       # run all tests
npm run lint   # run ESLint
```

CI runs lint and tests on Node 22 and 24 for every pull request and every push to `main`.
