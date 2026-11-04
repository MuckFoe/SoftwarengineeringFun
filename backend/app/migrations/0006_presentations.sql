-- Spec 013 (HTML presentations), plan "Data model". No cascades. No drawing table (FR-24):
-- strokes and the host's pointer live in memory only.

create table presentation (
    id                 uuid primary key default gen_random_uuid(),
    title              text not null check (char_length(title) between 1 and 100),
    topic              text not null check (char_length(topic) between 1 and 60),
    current_version_id uuid null,               -- set right after the first version insert
    created_by_sub     text not null,
    created_at         timestamptz not null default now(),
    removed_at         timestamptz null,
    removed_by_sub     text null,
    check ((removed_at is null) = (removed_by_sub is null))
);

create table presentation_version (
    id              uuid primary key default gen_random_uuid(),
    presentation_id uuid not null references presentation (id),
    html            text not null check (octet_length(html) between 1 and 5242880),
    kind            text not null check (kind in ('slides', 'page')),
    slide_count     int  not null check ((kind = 'slides' and slide_count >= 1)
                                      or (kind = 'page' and slide_count = 0)),
    created_by_sub  text not null,
    created_at      timestamptz not null default now()
);

alter table presentation add foreign key (current_version_id) references presentation_version (id);

create table presentation_session (
    id                  uuid primary key default gen_random_uuid(),
    invite_id           text not null unique,
    version_id          uuid not null references presentation_version (id),
    slide               int  null,              -- 0-based; null for a single page
    anchor              jsonb null,             -- last place's Anchor
    host_participant_id uuid null,              -- FK added below
    host_away_since     timestamptz null,
    created_at          timestamptz not null default now(),
    last_activity_at    timestamptz not null default now(),
    stale_at            timestamptz null
);

create table presentation_participant (
    id                uuid primary key default gen_random_uuid(),
    session_id        uuid not null references presentation_session (id),
    display_name      text not null,
    rejoin_token_hash text not null unique,     -- sha256 hex of the rejoin token
    joined_at         timestamptz not null default now(),
    left_at           timestamptz null
);

alter table presentation_session
    add foreign key (host_participant_id) references presentation_participant (id);

-- Same columns and checks as chat_message after 0005 (text or a GIF reference).
create table presentation_chat_message (
    id             bigserial primary key,
    session_id     uuid not null references presentation_session (id),
    participant_id uuid not null references presentation_participant (id),
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
    constraint presentation_chat_message_kind_shape check (coalesce(
        (kind = 'text' and char_length(body) between 1 and 2000
            and gif_id is null and gif_title is null and gif_url is null
            and gif_still_url is null and gif_width is null and gif_height is null)
     or (kind = 'gif' and body is null
            and gif_id is not null and gif_title is not null
            and gif_url ~ '^https?://' and gif_still_url ~ '^https?://'
            and gif_width > 0 and gif_height > 0),
        false))
);

create index presentation_chat_message_session on presentation_chat_message (session_id, id);
