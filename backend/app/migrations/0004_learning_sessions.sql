-- Spec 006 (plan.md, Data model): lessons, their versions and assets, and learning sessions.
-- Nothing is deleted. No cascades (matching 0001).

create table lesson_asset (
    sha256     text primary key,
    media_type text not null check (media_type in ('image/png','image/jpeg','image/gif','image/webp')),
    data       bytea not null
);

create table lesson_version (
    id           uuid primary key default gen_random_uuid(),
    lesson_key   text not null,
    content_hash text not null,
    content      jsonb not null,          -- full snapshot incl. answers; never sent as-is
    created_at   timestamptz not null default now(),
    unique (lesson_key, content_hash)
);

create table lesson (                    -- the current catalogue
    key                text primary key,
    topic_key          text not null,
    topic_title        text not null,
    current_version_id uuid null references lesson_version (id)
);

create table learning_session (
    id                uuid primary key default gen_random_uuid(),
    invite_id         text not null unique,
    lesson_version_id uuid not null references lesson_version (id),
    current_step      int not null default 0,        -- 0-based; = step count once completed
    completed_at      timestamptz null,
    created_at        timestamptz not null default now(),
    last_activity_at  timestamptz not null default now(),
    stale_at          timestamptz null
);

create table learning_participant (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references learning_session (id),
    display_name text not null,
    joined_at    timestamptz not null default now(),
    left_at      timestamptz null
);

create table learning_step (             -- one row per step once it has been current
    session_id          uuid not null references learning_session (id),
    position            int not null,
    hint_revealed_at    timestamptz null,
    answer_revealed_at  timestamptz null,
    passed_at           timestamptz null,
    passed_by_name      text null,
    passed_by           uuid null references learning_participant (id),
    primary key (session_id, position),
    check ((passed_at is null) = (passed_by_name is null))
);
-- "passed after the answer was revealed" (FR-14a) = answer_revealed_at is not null and passed_at is not null

create table learning_attempt (
    id             bigserial primary key,
    session_id     uuid not null references learning_session (id),
    position       int not null,
    participant_id uuid not null references learning_participant (id),
    actor_name     text not null,
    kind           text not null check (kind in ('choice','text','command')),
    submitted      jsonb not null,        -- list of option numbers, or the exact text typed
    correct        boolean not null,
    output         text null,             -- terminal response shown
    created_at     timestamptz not null default now()
);
create index learning_attempt_step on learning_attempt (session_id, position, id);

create table learning_chat_message (     -- same shape and rules as chat_message (spec 002)
    id             bigserial primary key,
    session_id     uuid not null references learning_session (id),
    participant_id uuid not null references learning_participant (id),
    sender_name    text not null,
    body           text not null check (char_length(body) between 1 and 2000),
    sent_at        timestamptz not null,
    removed_at     timestamptz null,
    removed_by_sub text null,
    check ((removed_at is null) = (removed_by_sub is null))
);
create index learning_chat_message_session on learning_chat_message (session_id, id);
