-- Spec 018: problem category and difficulty, and the seed ledger.
-- `category` and `difficulty` are nullable: editor-created problems and rows seeded before
-- this migration have none until the seed loader backfills the starters.
-- The category ids are the fixed list in app/problems/categories.py.

alter table problem
    add column category text null
        constraint problem_category_valid check (category in ('arrays', 'strings', 'hash-maps-sets', 'two-pointers-windows', 'stacks-queues', 'sorting-searching', 'recursion-backtracking', 'dynamic-programming', 'graphs-trees', 'math-bits', 'greedy-intervals')),
    add column difficulty text null
        constraint problem_difficulty_valid check (difficulty in ('easy', 'medium', 'hard'));

-- A row means "this starter was seeded once": it stops re-seeding after an editor deletes
-- the problem. problem_id is null when it was already gone at migration time. No ON DELETE
-- action: spec 001 NFR-9 forbids FK cascades and nulling, and the app only soft-deletes.
create table seeded_problem (
    seed_key   text primary key,
    problem_id uuid null references problem (id),
    seeded_at  timestamptz not null default now()
);

-- Backfill, once: a deployment that already holds problems seeded the 20 original starters.
-- Each is found by seed key, else by title (rows seeded before seed keys); absent = deleted.
insert into seeded_problem (seed_key, problem_id)
select legacy.seed_key,
       (select p.id from problem p
         where p.seed_key = legacy.seed_key
            or (p.seed_key is null and p.is_starter and p.title = legacy.title)
         order by (p.seed_key = legacy.seed_key) desc nulls last
         limit 1)
from (values
        ('01-sum-two', 'Sum Two Numbers'),
        ('02-reverse-words', 'Reverse Word Order'),
        ('03-count-vowels', 'Count Vowels'),
        ('04-max-of-three', 'Largest Of Three'),
        ('05-is-palindrome', 'Palindrome Check'),
        ('06-unique-elements', 'First Occurrences Only'),
        ('07-word-frequency', 'Word Frequency Count'),
        ('08-flatten-pairs', 'Flatten Pairs'),
        ('09-average-or-none', 'Average Or Nothing'),
        ('10-shift-letters', 'Shift Letters'),
        ('11-pair-sum-indices', 'Pair Sums To Target'),
        ('12-valid-brackets', 'Valid Brackets'),
        ('13-kth-smallest', 'Kth Smallest'),
        ('14-climb-steps', 'Count Ways To Climb'),
        ('15-insert-position', 'Find Insert Position'),
        ('16-digital-root', 'Digital Root'),
        ('17-max-profit', 'Best Single Trade'),
        ('18-common-elements', 'Common Elements'),
        ('19-merge-ranges', 'Merge Overlapping Ranges'),
        ('20-count-set-bits', 'Count Set Bits')
     ) as legacy (seed_key, title)
where exists (select 1 from problem);
