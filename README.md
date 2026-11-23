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
scripts/
  environments.sh        dev/prod targets (project, domain, region)
  deploy-cloudrun.sh     Build and deploy to Cloud Run
  map-domain.sh          Point the environment's domain at the service
  setup-github-deploy.sh One-time setup for the GitHub "Deploy" workflow
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
