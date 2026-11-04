-- Spec 007 (chat GIF search), plan "Data model": a chat message is text or a GIF reference.
-- No GIF bytes are stored (FR-12). Existing rows become kind = 'text' through the default.

alter table chat_message drop constraint chat_message_body_check;
alter table chat_message alter column body drop not null;

alter table chat_message
    add column kind            text not null default 'text' check (kind in ('text', 'gif')),
    add column gif_id          text null,
    add column gif_title       text null,           -- '' when GIPHY gives none
    add column gif_url         text null,
    add column gif_still_url   text null,
    add column gif_width       int  null,
    add column gif_height      int  null;

-- coalesce: a check that evaluates to NULL passes in Postgres, so a NULL body or gif_* column
-- would otherwise slip through.
alter table chat_message add constraint chat_message_kind_shape check (coalesce(
    (kind = 'text' and char_length(body) between 1 and 2000
        and gif_id is null and gif_title is null and gif_url is null
        and gif_still_url is null and gif_width is null and gif_height is null)
 or (kind = 'gif' and body is null
        and gif_id is not null and gif_title is not null
        and gif_url ~ '^https?://' and gif_still_url ~ '^https?://'
        and gif_width > 0 and gif_height > 0),
    false));
