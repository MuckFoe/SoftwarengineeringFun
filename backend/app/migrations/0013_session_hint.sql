-- Spec 020: model hints, stored with the session (FR-15), deleted with it (FR-16, spec 019 purge).
-- Numbered per (session, problem) (FR-13); the unique index also serves both list lookups.
-- No account id or sub is stored: `asked_by` is the display name shown with the hint (FR-6).

create table session_hint (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references session (id),
    problem_id  uuid not null references problem (id),
    number      int  not null check (number >= 1),
    asked_by    text not null,
    note        text null check (note is null or (char_length(note) between 1 and 200 and note !~ '[\r\n]')),
    body        text not null check (char_length(body) between 1 and 600),
    created_at  timestamptz not null default now(),
    unique (session_id, problem_id, number)
);
