-- Spec 020 FR-17 to FR-22: questions to the model, stored with the hints (FR-15).
-- `kind` separates hints from answers; each kind is numbered on its own per (session, problem).
-- `question` is the asker's question (answers only). `reveals_solution` marks an answer the
-- asker confirmed although it gives the solution away (FR-20), so it may be longer.

alter table session_hint
    add column kind text not null default 'hint' check (kind in ('hint', 'question')),
    add column question text null
        check (question is null or (char_length(question) between 1 and 500 and question !~ '[\r\n]')),
    add column reveals_solution boolean not null default false;

alter table session_hint
    add constraint session_hint_question_kind check ((kind = 'question') = (question is not null)),
    add constraint session_hint_reveal_kind check (kind = 'question' or not reveals_solution);

alter table session_hint drop constraint session_hint_body_check;
alter table session_hint add constraint session_hint_body_check
    check (char_length(body) between 1 and
        case when reveals_solution then 4000 when kind = 'question' then 1200 else 600 end);

alter table session_hint drop constraint session_hint_session_id_problem_id_number_key;
alter table session_hint add constraint session_hint_number_per_kind
    unique (session_id, problem_id, kind, number);
