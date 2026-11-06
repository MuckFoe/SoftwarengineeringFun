-- Spec 014: chess sessions, participants, games, moves and chat. No cascades, nothing dropped.

create table chess_session (
    id                     uuid primary key default gen_random_uuid(),
    invite_id              text not null unique,
    starter_participant_id uuid null,           -- FK below; set right after the starter's insert
    white_participant_id   uuid null,           -- FK below
    black_participant_id   uuid null,           -- FK below
    current_game_id        uuid null,           -- FK below; the in-progress or last finished game
    created_at             timestamptz not null default now(),
    last_activity_at       timestamptz not null default now(),
    stale_at               timestamptz null,
    deleted_at             timestamptz null,
    deleted_reason         text null check (deleted_reason in
                               ('resignation', 'abandonment', 'starter', 'admin')),
    deleted_by_sub         text null,           -- the admin's sub, else null
    check ((deleted_at is null) = (deleted_reason is null)),
    check (white_participant_id is distinct from black_participant_id
           or white_participant_id is null)
);

create table chess_participant (
    id                uuid primary key default gen_random_uuid(),
    session_id        uuid not null references chess_session (id),
    display_name      text not null,
    rejoin_token_hash text not null unique,
    joined_at         timestamptz not null default now(),
    left_at           timestamptz null,
    account_sub       text null,
    hidden_at         timestamptz null,
    check (hidden_at is null or account_sub is not null)
);
create unique index chess_participant_account on chess_participant (account_sub, session_id)
    where account_sub is not null;

create table chess_game (
    id                   uuid primary key default gen_random_uuid(),
    session_id           uuid not null references chess_session (id),
    white_participant_id uuid not null references chess_participant (id),
    black_participant_id uuid not null references chess_participant (id),
    started_at           timestamptz not null,
    draw_offer_by        text null check (draw_offer_by in ('white', 'black')),
    ended_at             timestamptz null,
    result               text null check (result in ('white', 'black', 'draw')),
    reason               text null check (reason in ('checkmate', 'resignation', 'abandonment',
                             'agreement', 'stalemate', 'insufficient_material',
                             'threefold_repetition', 'fifty_moves')),
    check ((ended_at is null) = (result is null) and (result is null) = (reason is null)),
    check (draw_offer_by is null or ended_at is null)
);

create table chess_move (
    game_id         uuid not null references chess_game (id),
    ply             int  not null check (ply >= 1),
    uci             text not null check (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
    san             text not null,
    participant_id  uuid not null references chess_participant (id),
    made_at         timestamptz not null,
    primary key (game_id, ply)
);

alter table chess_session
    add foreign key (starter_participant_id) references chess_participant (id),
    add foreign key (white_participant_id)   references chess_participant (id),
    add foreign key (black_participant_id)   references chess_participant (id),
    add foreign key (current_game_id)        references chess_game (id);

-- Same columns and checks as presentation_chat_message.
create table chess_chat_message (
    id             bigserial primary key,
    session_id     uuid not null references chess_session (id),
    participant_id uuid not null references chess_participant (id),
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
    constraint chess_chat_message_kind_shape check (coalesce(
        (kind = 'text' and char_length(body) between 1 and 2000
            and gif_id is null and gif_title is null and gif_url is null
            and gif_still_url is null and gif_width is null and gif_height is null)
     or (kind = 'gif' and body is null
            and gif_id is not null and gif_title is not null
            and gif_url ~ '^https?://' and gif_still_url ~ '^https?://'
            and gif_width > 0 and gif_height > 0),
        false))
);

create index chess_chat_message_session on chess_chat_message (session_id, id);
