-- Apply this script in the Supabase SQL Editor as a project administrator.
-- It creates the schema and policies, but does not create users or event data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.event_admins (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text not null check (length(btrim(last_name)) between 1 and 80),
  max_companions integer not null default 0 check (max_companions between 0 and 10),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.invitations(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text not null check (length(btrim(last_name)) between 1 and 80),
  attending boolean not null,
  companions integer not null default 0 check (companions between 0 and 10),
  comment text not null default '' check (length(comment) <= 500),
  updated_at timestamptz not null default now(),
  check (attending or companions = 0)
);

create index if not exists invitations_event_id_idx on public.invitations(event_id);
create index if not exists rsvps_invitation_id_idx on public.rsvps(invitation_id);

create or replace function public.is_event_admin(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_admins as ea
    where ea.event_id = target_event_id
      and ea.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_event_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_event_admin(uuid) to authenticated;

create or replace function public.submit_public_rsvp(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_attending boolean,
  p_companions integer,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation_id uuid;
  v_max_companions integer;
  v_token_hash text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    raise exception using errcode = '22023', message = 'Invalid invitation or event closed';
  end if;

  if p_first_name is null or length(btrim(p_first_name)) not between 1 and 80
    or p_last_name is null or length(btrim(p_last_name)) not between 1 and 80
    or p_attending is null
    or p_companions is null or p_companions not between 0 and 10
    or coalesce(length(p_comment), 0) > 500
    or (not p_attending and p_companions <> 0) then
    raise exception using errcode = '22023', message = 'Invalid response fields';
  end if;

  v_token_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select i.id, i.max_companions
    into v_invitation_id, v_max_companions
  from public.invitations as i
  join public.events as e on e.id = i.event_id
  where i.token_hash = v_token_hash
    and i.is_active
    and e.is_open;

  if not found then
    raise exception using errcode = '22023', message = 'Invalid invitation or event closed';
  end if;

  if p_companions > v_max_companions then
    raise exception using errcode = '22023', message = 'Companion count exceeds invitation limit';
  end if;

  insert into public.rsvps (
    invitation_id, first_name, last_name, attending, companions, comment, updated_at
  )
  values (
    v_invitation_id, btrim(p_first_name), btrim(p_last_name), p_attending,
    p_companions, coalesce(btrim(p_comment), ''), now()
  )
  on conflict (invitation_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        attending = excluded.attending,
        companions = excluded.companions,
        comment = excluded.comment,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_public_rsvp(text, text, text, boolean, integer, text) from public, authenticated;
grant execute on function public.submit_public_rsvp(text, text, text, boolean, integer, text) to anon;

alter table public.events enable row level security;
alter table public.event_admins enable row level security;
alter table public.invitations enable row level security;
alter table public.rsvps enable row level security;

drop policy if exists "Admins can read assigned events" on public.events;
create policy "Admins can read assigned events"
  on public.events for select to authenticated
  using (public.is_event_admin(id));

drop policy if exists "Admins can read their assignments" on public.event_admins;
create policy "Admins can read their assignments"
  on public.event_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins can read assigned invitations" on public.invitations;
create policy "Admins can read assigned invitations"
  on public.invitations for select to authenticated
  using (public.is_event_admin(event_id));

drop policy if exists "Admins can add assigned invitations" on public.invitations;
create policy "Admins can add assigned invitations"
  on public.invitations for insert to authenticated
  with check (public.is_event_admin(event_id));

drop policy if exists "Admins can update assigned invitations" on public.invitations;
create policy "Admins can update assigned invitations"
  on public.invitations for update to authenticated
  using (public.is_event_admin(event_id))
  with check (public.is_event_admin(event_id));

drop policy if exists "Admins can delete assigned invitations" on public.invitations;
create policy "Admins can delete assigned invitations"
  on public.invitations for delete to authenticated
  using (public.is_event_admin(event_id));

drop policy if exists "Admins can read assigned responses" on public.rsvps;
create policy "Admins can read assigned responses"
  on public.rsvps for select to authenticated
  using (
    exists (
      select 1
      from public.invitations as i
      where i.id = invitation_id
        and public.is_event_admin(i.event_id)
    )
  );

drop policy if exists "Admins can add assigned responses" on public.rsvps;
create policy "Admins can add assigned responses"
  on public.rsvps for insert to authenticated
  with check (
    exists (
      select 1
      from public.invitations as i
      where i.id = invitation_id
        and public.is_event_admin(i.event_id)
    )
  );

drop policy if exists "Admins can update assigned responses" on public.rsvps;
create policy "Admins can update assigned responses"
  on public.rsvps for update to authenticated
  using (
    exists (
      select 1
      from public.invitations as i
      where i.id = invitation_id
        and public.is_event_admin(i.event_id)
    )
  )
  with check (
    exists (
      select 1
      from public.invitations as i
      where i.id = invitation_id
        and public.is_event_admin(i.event_id)
    )
  );

drop policy if exists "Admins can delete assigned responses" on public.rsvps;
create policy "Admins can delete assigned responses"
  on public.rsvps for delete to authenticated
  using (
    exists (
      select 1
      from public.invitations as i
      where i.id = invitation_id
        and public.is_event_admin(i.event_id)
    )
  );

revoke all on public.events, public.event_admins, public.invitations, public.rsvps from public, anon, authenticated;
grant select on public.events to authenticated;
grant select on public.event_admins to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.rsvps to authenticated;
