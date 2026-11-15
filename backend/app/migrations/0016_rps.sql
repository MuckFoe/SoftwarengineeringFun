-- Spec 021: Rock Paper Siege sessions, participants, chat, games, pieces and duels.
-- Lifecycle columns and checks as the chess tables (0008, 0011, 0012); seats `a`/`b`.
-- No cascades, nothing dropped.

create table rps_session (
    id                     uuid primary key default gen_random_uuid(),
    invite_id              text not null unique,
    starter_participant_id uuid null,           -- FK below; set right after the starter's insert
    a_participant_id       uuid null,           -- FK below
    b_participant_id       uuid null,           -- FK below
    current_game_id        uuid null,           -- FK below; the in-progress or last finished game
    started_by_sub         text null,
    created_at             timestamptz not null default now(),
    last_activity_at       timestamptz not null default now(),
    stale_at               timestamptz null,
    deleted_at             timestamptz null,
    deleted_reason         text null check (deleted_reason in
                               ('resignation', 'abandonment', 'starter', 'admin')),
    deleted_by_sub         text null,           -- the admin's sub, else null
    check ((deleted_at is null) = (deleted_reason is null)),
    check (a_participant_id is distinct from b_participant_id
           or a_participant_id is null)
);

create table rps_participant (
    id                uuid primary key default gen_random_uuid(),
    session_id        uuid not null references rps_session (id),
    display_name      text not null,
    rejoin_token_hash text not null unique,
    joined_at         timestamptz not null default now(),
    left_at           timestamptz null,
    account_sub       text null,
    hidden_at         timestamptz null,
    check (hidden_at is null or account_sub is not null)
);
create unique index rps_participant_account on rps_participant (account_sub, session_id)
    where account_sub is not null;
create index rps_participant_first_signed_in on rps_participant (session_id, joined_at, id)
    where account_sub is not null;

create table rps_game (
    id                 uuid primary key default gen_random_uuid(),
    session_id         uuid not null references rps_session (id),
    a_participant_id   uuid not null references rps_participant (id),
    b_participant_id   uuid not null references rps_participant (id),
    first_side         text not null check (first_side in ('a', 'b')),        -- FR-8
    started_at         timestamptz not null,
    a_ready            boolean not null default false,                         -- FR-6
    b_ready            boolean not null default false,
    turn               text null check (turn in ('a', 'b')),   -- null in setup, during a duel, ended
    ply                int not null default 0,                 -- completed turns
    draw_offer_by      text null check (draw_offer_by in ('a', 'b')),
    ended_at           timestamptz null,
    result             text null check (result in ('a', 'b', 'draw')),
    reason             text null check (reason in ('flag', 'no_moves', 'resignation',
                                                   'abandonment', 'agreement')),  -- FR-20
    check ((ended_at is null) = (result is null) and (result is null) = (reason is null))
);
-- Phase is derived: ended if ended_at; play if a_ready and b_ready; else setup.

create table rps_piece (
    game_id   uuid not null references rps_game (id),
    square    smallint not null check (square between 0 and 41),   -- row * 7 + col
    side      text not null check (side in ('a', 'b')),
    kind      text not null check (kind in ('rock', 'paper', 'scissors', 'flag', 'trap')),
    revealed  boolean not null default false,                       -- FR-12; never true for flag/trap
    primary key (game_id, square)
);
-- A removed piece's row is deleted (no history is kept).

create table rps_duel (                                            -- FR-13, NFR-3
    game_id      uuid primary key references rps_game (id),
    from_square  smallint not null,      -- the attacker, still on its square
    to_square    smallint not null,      -- the defender
    attacker     text not null check (attacker in ('a', 'b')),
    round        int  not null default 1,
    a_pick       text null check (a_pick in ('rock', 'paper', 'scissors')),
    b_pick       text null check (b_pick in ('rock', 'paper', 'scissors')),
    last_a_pick  text null,              -- the previous, tied round; shown to everyone
    last_b_pick  text null
);

alter table rps_session
    add foreign key (starter_participant_id) references rps_participant (id),
    add foreign key (a_participant_id)       references rps_participant (id),
    add foreign key (b_participant_id)       references rps_participant (id),
    add foreign key (current_game_id)        references rps_game (id);

-- Same columns and checks as chess_chat_message.
create table rps_chat_message (
    id             bigserial primary key,
    session_id     uuid not null references rps_session (id),
    participant_id uuid not null references rps_participant (id),
    sender_name    text not null,
    body           text null,
    sent_at        timestamptz not null,
    removed_at     timestamptz null,
    removed_by_sub text null,
    kind           text not null default 'text' check (kind in ('text', 'gif')),
    gif_id         text null,
    gif_title      text null,                   -- '' when GIPHY gives none
    gif_url        text null,
    gif_still_url  text null,
    gif_width      int  null,
    gif_height     int  null,
    check ((removed_at is null) = (removed_by_sub is null)),
    -- coalesce: a check that evaluates to NULL passes in Postgres.
    constraint rps_chat_message_kind_shape check (coalesce(
        (kind = 'text' and char_length(body) between 1 and 2000
            and gif_id is null and gif_title is null and gif_url is null
            and gif_still_url is null and gif_width is null and gif_height is null)
     or (kind = 'gif' and body is null
            and gif_id is not null and gif_title is not null
            and gif_url ~ '^https?://' and gif_still_url ~ '^https?://'
            and gif_width > 0 and gif_height > 0),
        false))
);

create index rps_chat_message_session on rps_chat_message (session_id, id);

-- Spec 019 FR-8's tombstone covers rps sessions too.
alter table deleted_session drop constraint deleted_session_kind_check;
alter table deleted_session add constraint deleted_session_kind_check
    check (kind in ('coding', 'learning', 'presentation', 'chess', 'rps'));
