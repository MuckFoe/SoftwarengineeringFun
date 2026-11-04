-- Spec 012 (plan.md, Data model): participants that belong to an account, and account
-- preferences. No cascades, nothing dropped (matching earlier migrations).

-- FR-1, FR-3, FR-5, FR-7, FR-14: a participant belongs to at most one account per session.
alter table participant              add column account_sub text null, add column hidden_at timestamptz null;
alter table learning_participant     add column account_sub text null, add column hidden_at timestamptz null;
alter table presentation_participant add column account_sub text null, add column hidden_at timestamptz null;

-- One participant per (account, session); account first so it also serves the profile list (NFR-4).
create unique index participant_account              on participant              (account_sub, session_id) where account_sub is not null;
create unique index learning_participant_account     on learning_participant     (account_sub, session_id) where account_sub is not null;
create unique index presentation_participant_account on presentation_participant (account_sub, session_id) where account_sub is not null;

-- hidden_at is only ever set on an account's participant (FR-13).
alter table participant              add check (hidden_at is null or account_sub is not null);
alter table learning_participant     add check (hidden_at is null or account_sub is not null);
alter table presentation_participant add check (hidden_at is null or account_sub is not null);

-- FR-15, FR-16, NFR-3. A row exists once the account has preferences.
create table account_preference (
    account_sub  text primary key,
    appearance   text not null check (appearance in ('light', 'dark', 'system')),
    chat_visible boolean not null,
    updated_at   timestamptz not null default now()
);
