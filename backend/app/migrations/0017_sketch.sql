-- Spec 022: the shared sketch board of a coding session, one row per drawing action.
-- Visible actions are the rows after the latest `clear`; undo deletes the author's own row.

create table sketch_action (
    seq            bigserial primary key,
    session_id     uuid not null references session (id),
    author_id      uuid not null references participant (id),
    kind           text not null check (kind in ('pen', 'box', 'ellipse', 'erase', 'clear')),
    color          text check (color in ('ink','red','orange','yellow','green','blue','purple','pink')),
    points         jsonb,          -- flat int array [x0,y0,x1,y1,...]; null for clear
    client_id      text not null,
    bytes          integer not null,
    created_at     timestamptz not null default now(),
    check ((kind in ('pen','box','ellipse')) = (color is not null)),
    check ((kind = 'clear') = (points is null))
);
create index sketch_action_session_idx on sketch_action (session_id, seq);
