# 021 — Rock Paper Siege (rock-paper-scissors board game)

Status: approved

## Problem / Why

The *Games* section (spec 014) was built to hold more than chess, and chess is still its only game. People here remember an old messenger game in which two players fight on a small board with hidden rock, paper and scissors soldiers: you only learn what an enemy soldier carries when you fight it, ties are settled by a secret re-pick, and the game is won by finding the enemy flag while avoiding its trap. It is quicker and more luck-driven than chess, so it fits a break between coding sessions. This spec adds that game as the second game, played and watched exactly like chess sessions are: no account needed, invite link, two players and viewers. The rules below follow the remembered original and the user's decisions. No original rulebook survives, so where the remakes disagree, the user's decision is the rule.

## Users

- **Players**: the two participants who play one game: signed-in users or anonymous guests who joined by invite link.
- **Viewers**: every other participant in the session. They watch and chat, and they see every piece of both sides.
- **Session starter and admins**: they can delete a session, as for chess (spec 014).

## Terms

- **Board**: 7 columns by 6 rows. Each side's **home rows** are the two rows nearest to it. The middle two rows start empty.
- **Side**: one of the two players' armies. Sides are told apart within the app's style guide (constitution UI rules), not by any particular pair of colours.
- **Fighter**: a piece carrying rock, paper or scissors. Each side has 4 of each.
- **Flag**: one piece per side. It never moves. Capturing it wins the game.
- **Trap**: one piece per side. It never moves. Any fighter that attacks it is removed, and the trap stays where it is.
- **Hidden piece**: a piece whose kind the opponent does not know. To the opponent, every hidden piece looks the same.
- **Revealed piece**: a fighter whose weapon both players know because it has fought.
- **Duel**: how a fight between two fighters with the same weapon is settled. Both players secretly pick rock, paper or scissors until one pick beats the other.
- **Weapon order**: rock beats scissors, scissors beats paper, paper beats rock.

## Functional requirements

### The game in the Games section

- **FR-1** THE SYSTEM SHALL offer this game in the *Games* section beside chess. Anyone, signed in or not, can start a session of it.
- **FR-2** THE SYSTEM SHALL handle sessions of this game as chess sessions are handled in spec 014. That covers the invite link with no account needed, at most 5 participants, the first two in being the players and the rest viewers, switching between player and viewer before a game, the *Start* action (always shown, and shown again after each game), resignation, the away-player claim after 2 minutes, deletion, durable storage, stale after 30 days, chat as in specs 002/007, and listing on profiles as in spec 012. Where this spec says something different, this spec wins.
- **FR-3** THE SYSTEM SHALL not use the name, characters, artwork or sounds of the original messenger game. The game is called **Rock Paper Siege** and has its own artwork.

### Setup

- **FR-4** WHEN a game starts, THE SYSTEM SHALL let each player choose, on their own, which two of their 14 home-row squares hold their flag and their trap. The 12 fighters (4 rock, 4 paper, 4 scissors) are dealt at random onto the other 12 squares.
- **FR-5** WHILE a player has not confirmed their setup, THE SYSTEM SHALL let them move their flag and trap, and re-deal their fighters at random as often as they like.
- **FR-6** WHEN a player confirms their setup with *Ready*, THE SYSTEM SHALL lock it. When both players are ready, play begins.
- **FR-7** WHILE setting up, THE SYSTEM SHALL show each player 14 hidden pieces in the opponent's home rows and nothing about where the opponent's flag, trap or fighters are. Viewers see both setups as they are being made (FR-21).
- **FR-8** THE SYSTEM SHALL choose at random which player moves first in a session's first game. In each later game of the same session, the player who did not move first last time moves first.

### Moving

- **FR-9** WHEN it is a player's turn, THE SYSTEM SHALL let them move exactly one of their fighters one square up, down, left or right, onto an empty square or a square holding an enemy piece. A fighter cannot move diagonally, more than one square, off the board, or onto a square holding one of its own pieces.
- **FR-10** THE SYSTEM SHALL never let a flag or a trap move.
- **FR-11** WHEN a player moves a fighter onto an empty square, THE SYSTEM SHALL end their turn. A hidden fighter stays hidden when it moves.

### Fights

- **FR-12** WHEN a fighter moves onto a square holding an enemy fighter, THE SYSTEM SHALL reveal both weapons to both players and decide the fight by the weapon order. The losing fighter is removed. If the attacker wins, it takes the square. If the defender wins, it stays where it is. Every fighter that survives a fight stays revealed for the rest of the game.
- **FR-13** WHEN both fighters in a fight carry the same weapon, THE SYSTEM SHALL start a duel. Each player secretly picks rock, paper or scissors. Neither player sees the other's pick until both have picked. Picks are then shown to both, and the duel repeats while the picks are the same. The fighter whose pick wins also wins the fight, as in FR-12.
- **FR-14** WHEN a fighter wins a duel, THE SYSTEM SHALL let it keep the weapon it had before the duel. The winning pick decides the fight and changes nothing else.
- **FR-15** WHEN a fighter moves onto the enemy trap, THE SYSTEM SHALL remove the attacking fighter whatever its weapon, show both players that it fell into a trap, and leave the trap on its square. Afterwards the trap shows to the attacking player as a hidden piece again, and it removes every later attacker the same way.
- **FR-16** WHEN a fighter moves onto the enemy flag, THE SYSTEM SHALL end the game with the attacking player as the winner.
- **FR-17** WHEN a fight or duel ends, THE SYSTEM SHALL end the attacking player's turn.

### End of a game

- **FR-18** WHEN a player's turn begins and none of their fighters has a legal move (including when they have no fighters left), THE SYSTEM SHALL end the game with that player as the loser.
- **FR-19** WHEN one player offers a draw and the other accepts it, THE SYSTEM SHALL end the game as a draw. Only this ends a game in a draw: there is no move limit and no automatic draw. An offer that is declined or not answered before the next move lapses.
- **FR-20** WHEN a game ends, THE SYSTEM SHALL show everyone how it ended (flag captured, no legal move, resignation, draw by agreement or win by claim) and reveal every piece of both sides.

### What each person sees

- **FR-21** THE SYSTEM SHALL show each player their own pieces in full, and of the opponent only revealed fighters, plus the moment a trap catches one of their fighters (FR-15). Viewers see every piece of both sides at all times, and each duel pick once both picks are in.
- **FR-22** THE SYSTEM SHALL enforce FR-21 on the server. A player's device never receives the kind or position of an opponent piece the player may not see. That includes the opponent's setup and the opponent's duel pick before both picks are in.
- **FR-23** WHEN a participant switches from viewer to player between games, THE SYSTEM SHALL show them only a player's view from then on (FR-21). Because games are set up fresh each time, nothing they saw as a viewer is about the new game.
- **FR-24** WHEN a player reloads or rejoins during a game, THE SYSTEM SHALL restore their board, setup or pending duel pick exactly as it was, still under FR-21.

### Home screen, dock and jump bar

- **FR-25** THE SYSTEM SHALL show active sessions of this game on the home screen as game tiles, the way chess sessions are shown (spec 017). Each tile shows the game's name, the starter, the live state with participant count and avatars, and a board preview. The preview shows only what a player of that game could see of both sides, so hidden pieces look hidden. Activating the tile opens the session. A user who may not open the session sees no tile, title, avatar or code of it.
- **FR-26** THE SYSTEM SHALL reach this game through the existing *Games* dock entry, and list its sessions in the "Jump to anything" bar the way chess sessions are listed.

## Non-functional requirements

- **NFR-1 Fairness and secrecy.** Fighter deals and the first mover are chosen by the server with an unpredictable random source. No hidden information reaches a player's device early (FR-22). That holds in the live updates, the home tile preview, the profile list and every reload.
- **NFR-2 Responsiveness.** A move, fight result or duel outcome reaches both players and all viewers within 1 second on the hub, as chess moves do.
- **NFR-3 Durability.** A game in progress, including a setup not yet confirmed and a duel waiting for picks, survives a reload, a reconnect and a restart of the app.
- **NFR-4 No time pressure.** There are no move, setup or duel time limits. Only the away-player claim from spec 014 ends a stalled game.
- **NFR-5 UI rules.** The UI complies with `memory/constitution-ui.md`. That covers tokens only, one accent, primitives first, light and dark, narrow width (about 390 px) with the whole 7×6 board visible without horizontal scrolling, reduced motion with fight and trap effects turned off, and a board fully playable by keyboard. Pieces and squares have accessible names that state side, kind (or "hidden") and position, and fight results and duel outcomes are announced politely.
- **NFR-6 Original assets.** The artwork and name are the project's own (FR-3). Nothing from the original messenger game enters the repository.

## Out of scope

- A computer opponent.
- Time limits or clocks of any kind.
- Automatic draws: move limits, repetition or "no fight for N moves".
- Best-of series, scores across games, ratings or leaderboards.
- Replays or move history beyond what the session needs to restore the current game.
- Changes to the board size, piece counts or rules per session.
- Changes to chess or to how spec 014 sessions behave.

## Acceptance criteria

**AC-1 (FR-1)** Given an anonymous visitor in the *Games* section, when they look at the games offered, then this game is listed beside chess and they can start a session of it.

**AC-2 (FR-2)** Given a new session of this game, when three people join by its invite link, then the first two are players and the third is a viewer. A sixth person is refused because the session is full. Before *Start* is pressed, the viewer can switch to player only if a player switches to viewer.

**AC-3 (FR-3, NFR-6)** Given the game's screens and the repository, when they are reviewed, then neither shows the original game's name, characters, artwork or sounds.

**AC-4 (FR-4)** Given a game just started, when a player looks at their home rows, then they hold 4 rock, 4 paper and 4 scissors fighters plus a flag and a trap, and the player can put the flag and the trap on any two of the 14 home-row squares.

**AC-5 (FR-5)** Given a player who has not pressed *Ready*, when they press re-deal three times, then each time their 12 fighters are redealt at random onto the non-flag, non-trap squares, still 4 of each weapon, and the flag and trap stay where they put them.

**AC-6 (FR-6)** Given one player has pressed *Ready* and the other has not, when the ready player tries to change their setup, then they cannot, and no move can be made. When the second player presses *Ready*, play begins.

**AC-7 (FR-7, FR-22)** Given both players setting up, when the messages reaching player A's device are inspected, then they contain no kind or position of B's flag, trap or fighters, only 14 hidden pieces in B's home rows.

**AC-8 (FR-8)** Given a session's first game, when it starts over many sessions, then each player moves first in about half of them. Given game 1 in which player A moved first, when game 2 starts in the same session, then player B moves first.

**AC-9 (FR-9)** Given it is A's turn and a fighter of A's has an empty square to its right, a square of A's own below it, and an enemy piece above it, when A tries each move, then moving right and moving up are allowed, moving down is refused, and moving diagonally or two squares is refused. Given it is B's turn, when A tries to move, then the move is refused.

**AC-10 (FR-10)** Given it is A's turn, when A tries to move their flag or trap to any square, then the move is refused.

**AC-11 (FR-11)** Given A's hidden fighter, when it moves onto an empty square, then the turn passes to B and B still sees it as a hidden piece.

**AC-12 (FR-12)** Given A's rock attacks B's scissors, when the move is made, then both see both weapons, B's scissors are removed, and A's rock is on the square, revealed. Given A's rock attacks B's paper, then A's rock is removed, and B's paper stays on its square, revealed to both.

**AC-13 (FR-13, FR-22)** Given A's paper attacks B's paper, when the move is made, then both players are asked to pick. Before B picks, A's device has received nothing about B's pick. When both pick scissors, both are asked again. When A picks rock and B picks scissors, A's fighter wins as in AC-12.

**AC-14 (FR-14)** Given A's paper won a duel with a rock pick, when the duel ends, then the surviving fighter is shown to both players as paper.

**AC-15 (FR-15)** Given B's trap, when A's scissors attacks it, then A's scissors are removed, both players are shown that it fell into a trap, and the trap stays on its square. When A looks at the board afterwards, the trap shows as an ordinary hidden piece. When a second fighter of A's attacks it, that fighter is removed too.

**AC-16 (FR-16)** Given A's fighter next to B's flag, when it attacks the flag, then the game ends at once with A as the winner, whatever the fighter's weapon.

**AC-17 (FR-17)** Given A attacks and the fight (including any duel) ends, when it is over, then it is B's turn.

**AC-18 (FR-18)** Given it is B's turn and every remaining fighter of B's is boxed in by its own pieces, the board edge or nothing, or B has no fighters left, when B's turn begins, then the game ends with B as the loser.

**AC-19 (FR-19)** Given A offers a draw, when B accepts, then the game ends as a draw. Given A offers a draw, when B declines or makes a move instead, then the offer is gone and play continues. Given a game with no fight for 500 moves, when the 500th move is made, then the game is not ended.

**AC-20 (FR-20)** Given a game that ends by any of its endings, when it ends, then everyone sees how it ended and every piece of both sides is shown with its kind.

**AC-21 (FR-21)** Given a game in progress, when a viewer looks at the board, then they see the kind of every piece on both sides. When a duel is waiting for B's pick, the viewer has not received A's pick yet. Once both picks are in, the viewer sees both.

**AC-22 (FR-23)** Given a participant who was a viewer in game 1 switches to player for game 2, when game 2 is set up and played, then they receive only a player's view.

**AC-23 (FR-24, NFR-3)** Given A has placed their flag but not pressed *Ready*, B is mid-game waiting on a duel pick in another session, and the app restarts, when both reload, then A's flag position and dealt fighters are as before and still unconfirmed, and B is still asked for the same duel pick.

**AC-24 (FR-25, NFR-1)** Given an active session of this game in progress, when a user who may open it views the home screen, then a game tile shows the name, starter, Live state, participant count, avatars and a board preview, and the preview shows hidden pieces as hidden even to a viewer of that session. When the tile is activated, the session opens. Given a user who may not open the session, when they view the home screen, then nothing of it is rendered or sent.

**AC-25 (FR-26)** Given an active session of this game, when a user types its name in "Jump to anything", then it is listed and opens the session. The *Games* dock entry leads to the game.

**AC-26 (NFR-2)** Given two players and a viewer connected on the hub, when a player makes a move that causes a fight, then the result shows on all three screens within 1 second.

**AC-27 (NFR-5)** Given a 390 px wide screen in dark mode with reduced motion, when a game is played, then the whole board is visible without horizontal scrolling, nothing animates, and the game can be set up and played with the keyboard alone. A screen reader names each piece with side, kind or "hidden", and position, and announces fight results.

## UI spec checklist (constitution-ui.md, section E)

- [x] Home screen presence defined: game tile reusing the chess tile kind, with a secrecy-safe preview (FR-25)
- [x] Dock / Jump-to-anything entries defined: existing *Games* entry, sessions in the jump bar (FR-26)
- [x] Guest and invitee view defined: as chess (FR-2), with player and viewer visibility in FR-21/22
- [x] Tokens only; new tokens in light, dark and Keycloak theme (NFR-5)
- [x] Primitives reused; new ones justified (board and pieces to be justified in plan)
- [x] Narrow, dark, reduced-motion, keyboard and screen-reader behaviour stated (NFR-5, AC-27)
- [ ] Look matrix entry and E2E tasks present (for `/sdd-tasks`)

## Open questions

None. The game's name was resolved 2026-11-15: Rock Paper Siege.
