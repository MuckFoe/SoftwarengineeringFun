-- Text size preference: one of five steps of the type scale ('s', 0.75, by default),
-- applied to every text size so their ratios stay as designed. Stored like appearance.
alter table account_preference
    add column text_size text not null default 's'
        check (text_size in ('xs', 's', 'm', 'l', 'xl'));
