# 014 — Games section, starting with chess

Status: approved

## Problem / Why

The app is where people learn software engineering together in invite-link sessions: coding, lessons, presentations. Groups also want a break between those — something to play together without leaving the app, sending everyone to another site, or creating accounts elsewhere. This feature adds a *Games* section to the app, a home for games that people play together through the same kind of invite-link session they already know. Chess is its first game: two people play, anyone else in the session watches, and the session keeps the game and its chat the way other sessions keep theirs.

## Users

- **Starter**: whoever starts a chess session from the Games section — anyone, signed in or not.
- **Participants**: everyone in a chess session, the starter included, who joined by invite link without an account (as in 001) or signed in (as in 012). Each participant is, at any moment, either a **player** or a **viewer**.
- **Players**: the (at most) two participants seated at the board, one playing White, one playing Black.
- **Viewers**: every other participant. They watch the board and use the chat.
- **Admins** (as in 001): reactivate stale sessions and remove chat messages, as for other sessions, and delete chess sessions (FR-35).

## Functional requirements

### Games section

- **FR-1** WHEN anyone opens the app THE SYSTEM SHALL offer a *Games* section from the app's main navigation, alongside the existing sections.
- **FR-2** WHEN anyone opens the Games section THE SYSTEM SHALL list the available games, each with its name and a short description; chess is the only one in this feature, and the section is built to hold more later.
- **FR-3** WHEN anyone, signed in or not, starts a chess game from the Games section THE SYSTEM SHALL create a chess session with an invite link, add the starter to it as a participant, and show its board in the *not started* state.

### Joining, seats and roles

- **FR-4** WHEN someone opens a chess session's invite link THE SYSTEM SHALL let them join under a name without an account, with the same name rules as coding sessions (001); a signed-in user joins under their account username without a name prompt (012).
- **FR-5** WHEN a participant joins and a seat (White or Black) is free and no game is in progress THE SYSTEM SHALL seat them as a player in the free seat, White first; the starter therefore gets White and the next to join gets Black.
- **FR-6** WHEN a participant joins and both seats are taken, or a game is in progress, THE SYSTEM SHALL make them a viewer.
- **FR-7** WHILE no game is in progress THE SYSTEM SHALL let any player leave their seat to become a viewer, let any viewer take a free seat to become a player, and let a player move to the other seat if it is free.
- **FR-8** WHILE a game is in progress THE SYSTEM SHALL not let anyone change seats or switch between player and viewer.
- **FR-9** WHILE a chess session is open THE SYSTEM SHALL show every participant who sits at White, who sits at Black (or that a seat is free), and the list of viewers.

### Starting a game

- **FR-10** WHILE no game is in progress THE SYSTEM SHALL show every participant a *Start* button.
- **FR-11** WHEN a player presses *Start* while both seats are taken THE SYSTEM SHALL start a new game from the standard starting position with White to move, for every participant at once.
- **FR-12** WHILE a seat is free, or for a participant who is a viewer, THE SYSTEM SHALL show *Start* as unavailable, with the reason (waiting for a second player, or only players can start).
- **FR-13** WHEN a game ends THE SYSTEM SHALL return the session to *not started* — final position, move list and result stay visible until the next game starts — so that seats can be changed and *Start* pressed again for a new game in the same session.

### Playing

- **FR-14** WHILE a game is in progress THE SYSTEM SHALL show whose turn it is, and SHALL let only the player whose turn it is move, and only their own pieces.
- **FR-15** WHEN the player to move picks one of their pieces THE SYSTEM SHALL mark the squares it can legally move to.
- **FR-16** WHEN a player makes a move THE SYSTEM SHALL accept it only if it is legal under the standard rules of chess, including castling, en passant, pawn promotion and the rule that a move may not leave one's own king in check; an illegal move is refused and the board is unchanged.
- **FR-17** WHEN a pawn reaches the last rank THE SYSTEM SHALL let its player choose the piece it promotes to (queen, rook, bishop or knight).
- **FR-18** WHEN a move is accepted THE SYSTEM SHALL show it on every participant's board, highlight the move just made, and add it to a move list shown in standard algebraic notation.
- **FR-19** WHILE a king is in check THE SYSTEM SHALL mark it as in check for every participant.
- **FR-20** WHILE a game is in progress THE SYSTEM SHALL show each player the board with their own colour at the bottom, and show viewers the board with White at the bottom; any participant can flip their own view without affecting anyone else.
- **FR-21** WHEN a participant joins or reloads during a game THE SYSTEM SHALL show the current position, the full move list, whose turn it is and their own role immediately.

### Ending a game

- **FR-22** WHEN a move checkmates the opponent THE SYSTEM SHALL end the game as a win for the side that moved.
- **FR-23** WHEN a position is stalemate, has insufficient material for either side to checkmate, occurs for the third time with the same side to move, or 50 moves by each side have passed with no capture and no pawn move, THE SYSTEM SHALL end the game as a draw automatically, stating which of these caused it.
- **FR-24** WHEN a player resigns, after confirming, THE SYSTEM SHALL end the game as a win for the opponent, and then close the session (FR-34).
- **FR-25** WHEN a player offers a draw THE SYSTEM SHALL show the offer to the opponent, who may accept (the game ends as a draw by agreement) or decline; an offer lapses when either player makes a move.
- **FR-26** WHEN a game ends THE SYSTEM SHALL show every participant the result (White wins, Black wins, or draw) and its reason (checkmate, resignation, abandonment, agreement, or the draw rule from FR-23).
- **FR-33** WHEN, during a game, a player's opponent has been away (FR-28) for 2 minutes without interruption THE SYSTEM SHALL let the player who is present claim the win; a claim, after confirming, ends the game as a win for that player by abandonment, and then closes the session (FR-34). Before the 2 minutes have passed no claim is possible, and an opponent who comes back resets the 2 minutes.

### Session life

- **FR-27** WHEN the app restarts or a participant comes back later THE SYSTEM SHALL have kept the session, its participants, seats, the current or last game's position, move list and result, and its chat.
- **FR-28** WHEN a player leaves or disconnects during a game THE SYSTEM SHALL keep their seat and the game as it is, tell the other participants that player is away, and let the player continue when they return; there is no clock, so apart from FR-33 nothing is lost by waiting.
- **FR-29** WHEN a chess session has had no activity for 30 days THE SYSTEM SHALL mark it stale and show it read-only — board, move list, result and chat visible, no moves, seat changes, *Start* or chat messages — until an admin reactivates it, as for coding sessions (001).
- **FR-30** WHILE a chess session is open THE SYSTEM SHALL show the session chat beside the board with the same rules as other sessions' chat (002, 007), available to players and viewers alike.
- **FR-31** WHEN a signed-in user starts or joins a chess session THE SYSTEM SHALL list it among their sessions on their profile, as for the other session kinds (012), and let them reopen it as the same participant.
- **FR-32** WHEN someone tries to join a chess session that already has 5 participants (two players and three viewers at most) THE SYSTEM SHALL refuse them with a message that the session is full, as for coding sessions (001).
- **FR-34** WHEN a game ends by resignation (FR-24) or by abandonment (FR-33) THE SYSTEM SHALL show every connected participant the result and that the session is now closed, and delete the session: its invite link no longer opens it, it leaves every profile's session list (FR-31), and its board and chat can no longer be seen by anyone. Games that end by checkmate, a draw rule or agreement keep the session (FR-13).
- **FR-35** WHILE a chess session exists THE SYSTEM SHALL let its starter, and any admin, delete it at any time after confirming, with the same effect as FR-34; other participants cannot delete it.

## Non-functional requirements

- **NFR-1 Responsiveness.** An accepted move, a seat change, *Start*, a draw offer and a game's end appear for every connected participant within 1 second under normal network conditions.
- **NFR-2 Authority.** The rules, whose turn it is, and who may act are enforced by the app, not trusted from a participant's browser: a participant who manipulates their own browser still cannot make an illegal move, move for the other side, move as a viewer, or change seats during a game.
- **NFR-3 Consistency.** All participants always see the same position and move list; if two actions race (e.g. both players pressing *Start*, or a viewer and a player taking the same free seat), exactly one takes effect and everyone sees the same outcome.
- **NFR-4 Durability.** No accepted move is lost across an app restart.
- **NFR-5 Look and accessibility.** The Games section and chess session follow the app's design (003): macOS look, light/dark appearance, desktop ≥ 1024 px, WCAG AA. Moves can be made both with the pointer (click-click or drag) and with the keyboard alone; pieces and squares have text alternatives so the position can be followed without seeing the board.
- **NFR-6 Resources.** Chess sessions fit within the app's existing hub resource budget (005); a game in progress costs nothing while nobody is acting.
- **NFR-7 Assets.** Board and piece artwork is either made for this app or used under a licence that permits it; no assets taken from any existing chess website or product.

## Out of scope

- Playing against the computer, engine analysis, hints or move suggestions.
- Clocks / time controls of any kind.
- Ratings, rankings, leaderboards, player statistics, matchmaking or open-game lobbies (games are only reachable by invite link).
- Takebacks / undo of moves.
- A history of earlier games within a session beyond the last finished one; game export or import (e.g. PGN/FEN); replaying a finished game move by move.
- Chess variants (Chess960 etc.) and starting from a custom position.
- Any game other than chess. Adding the next game is a new spec.
- Viewer-specific restrictions (e.g. hiding chat from players), and more than two players.
- Narrow screens and mobile layouts (as in 003).

## Acceptance criteria

**AC-1 (FR-1, FR-2)** Given anyone opens the app, When they choose *Games* in the main navigation, Then they see a list containing chess with its name and a short description.

**AC-2 (FR-3)** Given a visitor who is not signed in is in the Games section, When they start a chess game, Then a chess session with an invite link is created, they are in it, and the board shows the starting position in the *not started* state.

**AC-3 (FR-4)** Given a chess session exists, When someone without an account opens its invite link and enters a valid name, Then they join; and Given a signed-in user opens the link, Then they join under their username with no name prompt.

**AC-4 (FR-5)** Given a starter alone in a new chess session, When a second person joins, Then the starter sits at White and the second person at Black.

**AC-5 (FR-6)** Given both seats are taken, When a third person joins, Then they are a viewer; and Given a game is in progress, When someone new joins, Then they are a viewer.

**AC-6 (FR-7)** Given no game is in progress, White is seated and Black is free, When a viewer takes the Black seat, Then they become Black's player; When White's player leaves their seat, Then they become a viewer and White is free; When Black's player moves to the free White seat, Then they are White and Black is free.

**AC-7 (FR-8, NFR-2)** Given a game is in progress, When any participant tries to leave a seat, take a seat or swap seats — through the page or by manipulating their browser — Then it is refused and seats are unchanged.

**AC-8 (FR-9)** Given a session with White, Black and two viewers, When any participant looks at the session, Then they see both players' names with their colours and both viewers' names.

**AC-9 (FR-10, FR-12)** Given no game is in progress and only White is seated, When any participant looks, Then *Start* is shown but unavailable with "waiting for a second player"; and Given both seats are taken, When a viewer looks, Then *Start* is unavailable with "only players can start".

**AC-10 (FR-11)** Given both seats are taken and no game is in progress, When either player presses *Start*, Then every participant sees the standard starting position with White to move.

**AC-11 (FR-13)** Given a game has just ended, When participants look, Then the final position, move list and result are shown, seats can be changed, and *Start* is available again; When *Start* is pressed, Then a new game begins from the starting position with an empty move list.

**AC-12 (FR-14, NFR-2)** Given a game in progress with White to move, When Black's player, or a viewer, tries to move any piece — through the page or by manipulating their browser — Then the move is refused and the board is unchanged; When White's player tries to move a black piece, Then it is refused.

**AC-13 (FR-15)** Given White to move from the starting position, When White's player picks the knight on g1, Then f3 and h3 are marked as its legal destinations and no other square is.

**AC-14 (FR-16)** Given positions set up by playing moves, When a player attempts: kingside and queenside castling when allowed; castling through check, out of check, or after the king or rook has moved; an en passant capture immediately after the opposing pawn's two-square advance and one move later; a move that leaves their own king in check, Then each legal one is accepted and each illegal one is refused with the board unchanged.

**AC-15 (FR-17)** Given a white pawn on the seventh rank with a free square ahead, When White's player moves it forward, Then they are asked to choose queen, rook, bishop or knight, and the chosen piece appears on the eighth rank (tested once with each choice, including a knight).

**AC-16 (FR-18)** Given a game in progress, When White plays e2–e4, Then every participant's board shows the pawn on e4, the move e2–e4 highlighted, and the move list shows `1. e4`; And captures, checks, castling and promotion appear in the move list in standard algebraic notation (e.g. `exd5`, `Bb5+`, `O-O`, `e8=Q`).

**AC-17 (FR-19)** Given a game in progress, When a move gives check, Then the checked king is marked as in check on every participant's board, and the mark disappears once the check is resolved.

**AC-18 (FR-20)** Given a game in progress, When White's player, Black's player and a viewer look, Then White's player sees White at the bottom, Black's player sees Black at the bottom, the viewer sees White at the bottom; When the viewer flips their view, Then only their own view changes.

**AC-19 (FR-21)** Given a game in progress after ten moves, When a viewer reloads the page or a new participant joins, Then they see the current position, the full move list, whose turn it is and their own role without waiting for another move.

**AC-20 (FR-22, FR-26)** Given a game in progress, When White plays the moves leading to checkmate (e.g. the four-move mate `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#`), Then the game ends and every participant sees "White wins — checkmate".

**AC-21 (FR-23, FR-26)** Given games played into, respectively, a stalemate, king against king, the same position arising for the third time with the same side to move, and 50 moves by each side without a capture or pawn move, When the deciding move is made, Then the game ends as a draw and every participant sees which of the four reasons applies.

**AC-22 (FR-24, FR-34)** Given a game in progress, When Black's player resigns and confirms, Then the game ends, everyone connected sees "White wins — resignation" and that the session is closed, and the invite link no longer opens it; When a player chooses resign but does not confirm, Then the game continues.

**AC-23 (FR-25)** Given a game in progress, When White offers a draw and Black accepts, Then the game ends as "Draw — agreement"; When White offers and Black declines, Then the game continues and the offer is gone; When White offers and then either player moves, Then the offer is gone.

**AC-24 (FR-27, NFR-4)** Given a game in progress with moves made and chat messages sent, When the app is restarted, Then the session, seats, position, move list and chat are all as they were and play continues.

**AC-25 (FR-28)** Given a game in progress, When Black's player closes their browser, Then the others are told Black's player is away, the seat stays theirs and nobody else can take it; When they reopen the session, Then they are Black again and can make their move.

**AC-26 (FR-29)** Given a chess session with no activity for 30 days, When anyone opens it, Then it is marked stale and the board, move list, result and chat are visible but no move, seat change, *Start* or chat message is possible; When an admin reactivates it, Then all of those are possible again.

**AC-27 (FR-30)** Given a chess session, When a player and a viewer each send a chat message, Then both messages appear beside the board for every participant, following the chat rules of 002/007.

**AC-28 (FR-31)** Given a signed-in user starts one chess session and joins another, When they open their profile, Then both appear in their list of sessions as chess sessions, and reopening one makes them the same participant (same seat or role) as before.

**AC-29 (NFR-1)** Given three participants connected to a game, When a player makes a move, Then the other two see it within 1 second.

**AC-30 (NFR-3)** Given both seats taken and no game in progress, When both players press *Start* at the same moment, Then exactly one game starts; Given one free seat, When two viewers take it at the same moment, Then exactly one becomes the player and both see the same result.

**AC-31 (NFR-5)** Given a game in progress, When White's player uses only the keyboard, Then they can select a piece, choose a destination square and complete a move including a promotion choice; And a screen reader announces each square's piece and the last move.

**AC-32 (FR-32)** Given a chess session with 5 participants, When a sixth person opens its invite link, Then they are refused with a message that the session is full.

**AC-33 (FR-33, FR-34)** Given a game in progress, When Black's player has been away for 1 minute 59 seconds, Then White's player cannot claim the win; When Black's player has been away for 2 minutes, Then White's player can claim it, and after confirming everyone connected sees "White wins — abandonment" and that the session is closed; Given Black's player was away for 90 seconds, came back and left again, When 60 more seconds pass, Then no claim is possible yet.

**AC-34 (FR-34)** Given a session closed by resignation or abandonment, When anyone opens its invite link, Then they are told the session no longer exists; And it is gone from the profile of every signed-in participant. Given a game ended by checkmate, When participants look, Then the session is still there (AC-11).

**AC-35 (FR-35)** Given a chess session, When its starter chooses delete and confirms, Then the session is deleted as in AC-34 and everyone connected is told; When an admin does the same, Then likewise; When another participant, or anyone through a manipulated browser, tries to delete it, Then it is refused and the session is unchanged; When the starter chooses delete but does not confirm, Then nothing changes.

## Open questions

None. Resolved 2026-11-06:

- Participant limit: 5, as coding sessions → FR-32.
- Stalled games: resigning is always possible (FR-24); after the opponent has been away 2 minutes the present player can claim the win (FR-33); ending by resignation or abandonment deletes the session (FR-34); the starter or an admin can delete it at any time (FR-35).
