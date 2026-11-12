-- Spec 019 FR-0 / NFR-4: the host rule's fallback, "the first signed-in participant to join",
-- looks up a session's participants by (session_id) ordered by (joined_at, id). Without these
-- the profile list and `host_sub` scan whole participant tables.

create index participant_first_signed_in       on participant       (session_id, joined_at, id)
    where account_sub is not null;
create index learning_participant_first_signed_in on learning_participant (session_id, joined_at, id)
    where account_sub is not null;
create index chess_participant_first_signed_in on chess_participant (session_id, joined_at, id)
    where account_sub is not null;
