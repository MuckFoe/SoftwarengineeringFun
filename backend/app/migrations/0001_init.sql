-- Schema for spec 001 (plan.md, Data model).
-- No foreign key cascades deletes: nothing is ever deleted automatically (NFR-9).
-- No credentials are stored: identity is the OIDC subject only (NFR-8).

create table problem (
    id              uuid primary key default gen_random_uuid(),
    title           text not null,
    description     text not null,
    signature       text not null,
    function_name   text not null,
    params          jsonb not null,
    return_type     text not null,
    is_starter      boolean not null default false,
    created_by_sub  text null,
    created_by_name text null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz null
);

create table problem_test (
    id         uuid primary key default gen_random_uuid(),
    problem_id uuid not null references problem (id),
    position   int not null,
    args       jsonb not null,
    expected   jsonb not null,
    unique (problem_id, position)
);

create table session (
    id                 uuid primary key default gen_random_uuid(),
    invite_id          text not null unique,
    current_problem_id uuid not null references problem (id),
    created_at         timestamptz not null default now(),
    last_activity_at   timestamptz not null default now(),
    stale_at           timestamptz null
);

create table session_problem (
    session_id  uuid not null references session (id),
    problem_id  uuid not null references problem (id),
    accepted    boolean not null default false,
    accepted_at timestamptz null,
    primary key (session_id, problem_id)
);

create table participant (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references session (id),
    display_name text not null,
    joined_at    timestamptz not null default now(),
    left_at      timestamptz null
);

-- Append-only; replaying a session's updates rebuilds its code (FR-27).
create table yjs_update (
    id         bigserial primary key,
    session_id uuid not null references session (id),
    update     bytea not null,
    created_at timestamptz not null default now()
);
create index yjs_update_session on yjs_update (session_id, id);

create table run (
    id             uuid primary key default gen_random_uuid(),
    session_id     uuid not null references session (id),
    problem_id     uuid not null references problem (id),
    code           text not null,
    participant_id uuid not null references participant (id),
    status         text not null check (status in ('running', 'done', 'infra_error')),
    started_at     timestamptz not null default now(),
    finished_at    timestamptz null
);
-- At most one run in progress per session (FR-26).
create unique index run_one_active on run (session_id) where status = 'running';

create table run_result (
    run_id        uuid not null references run (id),
    test_position int not null,
    outcome       text not null,
    error_message text null,
    traceback     text null,
    primary key (run_id, test_position)
);

-- kinds: joined, left, switched, run_started, run_finished, stale, reactivated
create table session_event (
    id         bigserial primary key,
    session_id uuid not null references session (id),
    kind       text not null,
    actor      text not null,
    payload    jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index session_event_session on session_event (session_id, id);
