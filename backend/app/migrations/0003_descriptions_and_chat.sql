-- Spec 002 (plan.md, Data model): description images and session chat.
-- Chat rows are hidden by an admin, never deleted (FR19): removed_at and removed_by_sub go together.

create table problem_image (
    id              uuid primary key default gen_random_uuid(),
    media_type      text not null
                    check (media_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
    data            bytea not null check (octet_length(data) between 1 and 2097152),
    uploaded_by_sub text not null,
    created_at      timestamptz not null default now()
);

create table chat_message (
    id             bigserial primary key,
    session_id     uuid not null references session (id),
    participant_id uuid not null references participant (id),
    sender_name    text not null,
    body           text not null check (char_length(body) between 1 and 2000),
    sent_at        timestamptz not null,
    removed_at     timestamptz null,
    removed_by_sub text null,
    check ((removed_at is null) = (removed_by_sub is null))
);

create index chat_message_session_id_idx on chat_message (session_id, id);
