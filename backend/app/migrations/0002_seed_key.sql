-- Seed identity (plan.md, Seed): the `seed/problems/` folder a starter problem came from.
-- The loader inserts each folder whose key is absent, so seed problems added later load into
-- an existing catalogue, and editors' renames and deletions survive restarts (FR-6, FR-7, FR-8).

alter table problem add column seed_key text null;

create unique index problem_seed_key on problem (seed_key) where seed_key is not null;
