-- Spec 019: who started a session (FR-0), and the tombstone a deleted session leaves (FR-8).
-- `started_by_sub` is null for a guest start and for sessions started before this migration;
-- the host rule then falls back to the first signed-in participant.

alter table session          add column started_by_sub text null;
alter table learning_session add column started_by_sub text null;
alter table chess_session    add column started_by_sub text null;

-- FR-8: a deleted session leaves only this. Everything else of it is gone (FR-6).
-- No account id, title or count is kept; `deleted_by` only picks the message's wording.
create table deleted_session (
    kind           text not null check (kind in ('coding', 'learning', 'presentation', 'chess')),
    invite_id      text not null,
    deleted_at     timestamptz not null default now(),
    deleted_by     text not null check (deleted_by in ('host', 'admin')),
    primary key (kind, invite_id)
);
