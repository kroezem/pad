begin;

create function public.edit_note(p_id uuid) returns public.notes
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); target public.notes; draft public.notes;
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select * into target from public.notes where id = p_id and user_id = u and status = 'archived' for update;
  if target.id is null then raise exception 'Archived note not found' using errcode = 'P0002'; end if;
  select * into draft from public.notes where user_id = u and status = 'current' for update;
  if draft.id is not null then
    if draft.content ~ '[^[:space:]]' then
      update public.notes set status = 'archived', archived_at = now(), updated_at = now() where id = draft.id;
    else
      delete from public.notes where id = draft.id;
    end if;
  end if;
  update public.notes set status = 'current', archived_at = null, version = version + 1,
    updated_at = now(), last_edited_at = now() where id = target.id returning * into target;
  return target;
end;
$$;

create function public.delete_note(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  delete from public.notes where id = p_id and user_id = u and status = 'archived';
  if not found then raise exception 'Archived note not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.feed_notes(p_before timestamptz default null, p_limit integer default 50)
returns table (id uuid, content text, created_at timestamptz, archived_at timestamptz, attachments jsonb)
language sql stable security invoker set search_path = '' as $$
  with page as (
    select n.archived_at from public.notes n
    where n.user_id = auth.uid() and n.status = 'archived'
      and (p_before is null or n.archived_at < p_before)
    order by n.archived_at desc, n.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select n.id, n.content, n.created_at, n.archived_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path,
      'filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes))
      from public.attachments a where a.note_id = n.id and a.user_id = auth.uid()), '[]'::jsonb)
  from public.notes n
  where n.user_id = auth.uid() and n.status = 'archived'
    and (p_before is null or n.archived_at < p_before)
    and n.archived_at >= (select min(page.archived_at) from page)
  order by n.archived_at desc, n.id desc;
$$;

-- Include timestamp ties at the page boundary so the timestamp cursor skips no blocks.
drop function public.search_notes(text, integer, integer);
create function public.search_notes(p_query text, p_limit integer default 50, p_offset integer default 0, p_filter text default 'all')
returns table (id uuid, content text, created_at timestamptz, archived_at timestamptz, snippet text, rank real, attachments jsonb)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select btrim(coalesce(p_query, '')) as text,
      websearch_to_tsquery('simple', coalesce(p_query, '')) as query
  )
  select n.id, n.content, n.created_at, n.archived_at,
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
  where n.user_id = auth.uid() and n.status = 'archived'
    and (p_filter = 'all'
      or (p_filter = 'links' and btrim(n.content, E' \t\r\n') ~* '^https?://[^[:space:]]+$')
      or (p_filter = 'text' and btrim(n.content, E' \t\r\n') !~* '^https?://[^[:space:]]+$'))
    and (q.text = '' or n.search @@ q.query
      or n.content ilike '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or extensions.similarity(n.content, q.text) > 0.1
      or extensions.word_similarity(q.text, n.content) > 0.4)
  order by n.archived_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

alter table public.notes replica identity full;
revoke all on function public.edit_note(uuid), public.delete_note(uuid), public.feed_notes(timestamptz, integer), public.search_notes(text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.edit_note(uuid), public.delete_note(uuid), public.feed_notes(timestamptz, integer), public.search_notes(text, integer, integer, text) to authenticated;

commit;
