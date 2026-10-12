begin;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists pad_private;
revoke all on schema pad_private from public, anon, authenticated;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null default 'text',
  content text not null default '',
  tags text[] not null default '{}',
  status text not null default 'current' check (status in ('current', 'archived')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_edited_at timestamptz not null default now(),
  archived_at timestamptz,
  search tsvector generated always as (to_tsvector('simple', content)) stored,
  unique (id, user_id)
);
create unique index notes_one_current on public.notes (user_id) where status = 'current';
create index notes_search on public.notes using gin (search);
create index notes_content_trgm on public.notes using gin (content extensions.gin_trgm_ops);
create index notes_history on public.notes (user_id, status, archived_at desc);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade
);
create index attachments_note on public.attachments (note_id);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text not null,
  key_hash text unique not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.api_keys enable row level security;
create policy notes_select on public.notes for select to authenticated using (user_id = auth.uid());
create policy notes_insert on public.notes for insert to authenticated with check (user_id = auth.uid() and status = 'current');
create policy notes_update on public.notes for update to authenticated using (user_id = auth.uid() and status = 'current') with check (user_id = auth.uid() and status = 'current');
create policy notes_delete on public.notes for delete to authenticated using (user_id = auth.uid() and status = 'current');
create policy attachments_owner on public.attachments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy api_keys_owner on public.api_keys for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notes, public.attachments, public.api_keys from public, anon, authenticated;
-- Note writes use RPCs so versions, timestamps and rollover cannot be bypassed.
grant select on public.notes to authenticated;
grant select, insert, update, delete on public.attachments, public.api_keys to authenticated;
grant all on public.notes, public.attachments, public.api_keys to service_role;

create function pad_private.content_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.content is distinct from old.content then
    new.version := old.version + 1;
    new.updated_at := now();
    new.last_edited_at := now();
  end if;
  return new;
end;
$$;
create trigger notes_content_changed before update on public.notes
for each row execute function pad_private.content_changed();

-- Every writer takes the same transaction lock, including when no row exists yet.
create function pad_private.current_note(p_user_id uuid, p_force boolean default false)
returns public.notes language plpgsql security definer set search_path = '' as $$
declare n public.notes;
begin
  if p_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into n from public.notes where user_id = p_user_id and status = 'current' for update;
  if n.id is not null and n.content ~ '[^[:space:]]' and
     (p_force or n.last_edited_at < now() - interval '3 hours') then
    update public.notes set status = 'archived', archived_at = now(), updated_at = now() where id = n.id;
    n := null;
  end if;
  if n.id is null then
    insert into public.notes (user_id) values (p_user_id) returning * into n;
  end if;
  return n;
end;
$$;

create function public.get_current_note() returns public.notes
language sql security definer set search_path = '' as $$
  select pad_private.current_note(auth.uid());
$$;
create function public.new_note() returns public.notes
language sql security definer set search_path = '' as $$
  select pad_private.current_note(auth.uid(), true);
$$;

create function public.save_note(p_id uuid, p_content text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); n public.notes;
begin
  if u is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_content is null then raise exception 'Content is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select * into n from public.notes where user_id = u and status = 'current' for update;
  if n.id is null then n := pad_private.current_note(u); end if;
  if n.id is distinct from p_id then
    n := pad_private.current_note(u);
    return jsonb_build_object('ok', false, 'note', to_jsonb(n) - 'search');
  end if;
  if n.content ~ '[^[:space:]]' and n.last_edited_at < now() - interval '3 hours' then
    n := pad_private.current_note(u);
    update public.notes set content = p_content, last_edited_at = now(), updated_at = now()
      where id = n.id returning * into n;
    return jsonb_build_object('ok', true, 'note', to_jsonb(n) - 'search');
  end if;
  if n.version is distinct from p_expected_version then
    return jsonb_build_object('ok', false, 'note', to_jsonb(n) - 'search');
  end if;
  update public.notes set content = p_content, last_edited_at = now(), updated_at = now()
    where id = n.id returning * into n;
  return jsonb_build_object('ok', true, 'note', to_jsonb(n) - 'search');
end;
$$;

create function public.search_notes(p_query text, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, created_at timestamptz, archived_at timestamptz, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select btrim(coalesce(p_query, '')) as text,
      websearch_to_tsquery('simple', coalesce(p_query, '')) as query
  )
  select n.id, n.created_at, n.archived_at,
    case when q.text = '' then left(n.content, 240)
      when n.search @@ q.query then ts_headline('simple', n.content, q.query,
        'StartSel=, StopSel=, MaxWords=45, MinWords=15, MaxFragments=1')
      else substring(n.content from greatest(1, strpos(lower(n.content), lower(q.text)) - 60) for 240)
    end,
    (ts_rank(n.search, q.query) + extensions.similarity(n.content, q.text))::real as rank
  from public.notes n cross join q
  where n.user_id = auth.uid() and n.status = 'archived'
    and (q.text = '' or n.search @@ q.query
      or n.content ilike '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or extensions.similarity(n.content, q.text) > 0.1
      or extensions.word_similarity(q.text, n.content) > 0.4)
  order by case when q.text <> '' then ts_rank(n.search, q.query) + extensions.similarity(n.content, q.text) else 0 end desc,
    n.archived_at desc, n.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.append_to_current(p_user_id uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.notes;
begin
  if p_text is null or p_text !~ '[^[:space:]]' or char_length(p_text) > 100000 then
    raise exception 'Invalid append text';
  end if;
  n := pad_private.current_note(p_user_id);
  update public.notes set content = n.content ||
    case when n.content <> '' and right(n.content, 1) <> E'\n' then E'\n' else '' end || p_text,
    last_edited_at = now(), updated_at = now() where id = n.id;
end;
$$;

revoke all on all functions in schema pad_private from public, anon, authenticated, service_role;
revoke all on function public.get_current_note(), public.new_note(), public.save_note(uuid, text, integer), public.search_notes(text, integer, integer), public.append_to_current(uuid, text) from public, anon, authenticated;
grant execute on function public.get_current_note(), public.new_note(), public.save_note(uuid, text, integer), public.search_notes(text, integer, integer) to authenticated;
grant execute on function public.append_to_current(uuid, text) to service_role;
alter publication supabase_realtime add table public.notes;

commit;
