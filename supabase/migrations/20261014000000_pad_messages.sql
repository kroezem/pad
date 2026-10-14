begin;

drop function public.get_current_note();
drop function public.new_note();
drop function public.save_note(uuid, text, integer);
drop function public.edit_note(uuid);
drop function public.append_to_current(uuid, text);
drop function pad_private.current_note(uuid, boolean);
drop trigger notes_content_changed on public.notes;
drop function pad_private.content_changed();
drop function public.feed_notes(timestamptz, integer);
drop function public.search_notes(text, integer, integer, text);

drop policy notes_insert on public.notes;
drop policy notes_update on public.notes;
drop policy notes_delete on public.notes;

alter table public.notes add column sent_at timestamptz;
update public.notes set sent_at = archived_at where status = 'archived';
update public.notes set sent_at = last_edited_at where status = 'current' and content ~ '[^[:space:]]';
delete from public.notes where status = 'current' and content !~ '[^[:space:]]';
alter table public.notes alter column sent_at set not null;
alter table public.notes alter column sent_at set default now();
drop index public.notes_one_current;
drop index public.notes_history;
alter table public.notes drop column status, drop column version,
  drop column last_edited_at, drop column archived_at;
create index notes_feed on public.notes (user_id, sent_at desc);

create policy notes_insert on public.notes for insert to authenticated with check (user_id = auth.uid());
create policy notes_update on public.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_delete on public.notes for delete to authenticated using (user_id = auth.uid());
grant update (content) on public.notes to authenticated;

create function pad_private.message_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.sent_at := now();
  return new;
end;
$$;
create trigger notes_message_changed before update on public.notes
for each row execute function pad_private.message_changed();
revoke all on function pad_private.message_changed() from public, anon, authenticated, service_role;

create function public.send_note(p_content text) returns public.notes
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); n public.notes;
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_content is null or p_content !~ '[^[:space:]]' then raise exception 'Content is required'; end if;
  insert into public.notes (user_id, content, sent_at) values (u, p_content, now()) returning * into n;
  return n;
end;
$$;

create function public.update_note(p_id uuid, p_content text) returns public.notes
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); n public.notes;
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_content is null or p_content !~ '[^[:space:]]' then raise exception 'Content is required'; end if;
  update public.notes set content = p_content, updated_at = now(), sent_at = now()
    where id = p_id and user_id = u returning * into n;
  if n.id is null then raise exception 'Message not found' using errcode = 'P0002'; end if;
  return n;
end;
$$;

create or replace function public.delete_note(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.notes where id = p_id and user_id = u;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.insert_note_for_user(p_user_id uuid, p_text text) returns public.notes
language plpgsql security definer set search_path = '' as $$
declare n public.notes;
begin
  if p_user_id is null or p_text is null or p_text !~ '[^[:space:]]' or char_length(p_text) > 100000 then
    raise exception 'Invalid message';
  end if;
  insert into public.notes (user_id, content, sent_at) values (p_user_id, p_text, now()) returning * into n;
  return n;
end;
$$;

create function public.feed_notes(p_before timestamptz default null, p_limit integer default 50)
returns table (id uuid, content text, created_at timestamptz, sent_at timestamptz, attachments jsonb)
language sql stable security invoker set search_path = '' as $$
  with page as (
    select n.sent_at from public.notes n
    where n.user_id = auth.uid()
      and (p_before is null or n.sent_at < p_before)
    order by n.sent_at desc, n.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select n.id, n.content, n.created_at, n.sent_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path,
      'filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes))
      from public.attachments a where a.note_id = n.id and a.user_id = auth.uid()), '[]'::jsonb)
  from public.notes n
  where n.user_id = auth.uid()
    and (p_before is null or n.sent_at < p_before)
    and n.sent_at >= (select min(page.sent_at) from page)
  order by n.sent_at desc, n.id desc;
$$;

create function public.search_notes(p_query text, p_limit integer default 50, p_offset integer default 0, p_filter text default 'all')
returns table (id uuid, content text, created_at timestamptz, sent_at timestamptz, snippet text, rank real, attachments jsonb)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select btrim(coalesce(p_query, '')) as text,
      websearch_to_tsquery('simple', coalesce(p_query, '')) as query
  )
  select n.id, n.content, n.created_at, n.sent_at,
    case when q.text = '' then left(n.content, 240)
      when n.search @@ q.query then ts_headline('simple', n.content, q.query,
        'StartSel=, StopSel=, MaxWords=45, MinWords=15, MaxFragments=1')
      else substring(n.content from greatest(1, strpos(lower(n.content), lower(q.text)) - 60) for 240)
    end,
    (ts_rank(n.search, q.query) + extensions.similarity(n.content, q.text))::real,
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path,
      'filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes))
      from public.attachments a where a.note_id = n.id and a.user_id = auth.uid()), '[]'::jsonb)
  from public.notes n cross join q
  where n.user_id = auth.uid()
    and (p_filter = 'all'
      or (p_filter = 'links' and btrim(n.content, E' \t\r\n') ~* '^https?://[^[:space:]]+$')
      or (p_filter = 'text' and btrim(n.content, E' \t\r\n') !~* '^https?://[^[:space:]]+$'))
    and (q.text = '' or n.search @@ q.query
      or n.content ilike '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or extensions.similarity(n.content, q.text) > 0.1
      or extensions.word_similarity(q.text, n.content) > 0.4)
  order by n.sent_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


revoke all on function public.send_note(text), public.update_note(uuid, text), public.delete_note(uuid),
  public.feed_notes(timestamptz, integer), public.search_notes(text, integer, integer, text),
  public.insert_note_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.send_note(text), public.update_note(uuid, text), public.delete_note(uuid),
  public.feed_notes(timestamptz, integer), public.search_notes(text, integer, integer, text) to authenticated;
grant execute on function public.insert_note_for_user(uuid, text) to service_role;

commit;
