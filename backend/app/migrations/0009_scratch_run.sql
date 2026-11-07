-- Spec 011: the last "run with own input" per session. One row per session, replaced by the next run.

create table session_scratch_run (
    session_id uuid primary key references session (id),
    status     text not null check (status in
                   ('running', 'finished', 'error', 'time_limit', 'output_limit', 'interrupted')),
    started_by text not null,
    started_at timestamptz not null default now(),
    ended_at   timestamptz null,
    input      text not null,
    output     jsonb not null default '[]'::jsonb,
    exit_code  int null
);
