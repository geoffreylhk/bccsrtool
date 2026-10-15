-- Run once in your hosted project's SQL Editor. No existing profile/data changes.
begin;
create table public.saved_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload @> '{"version":5,"activeProfileId":"assessment"}'::jsonb
    and coalesce(jsonb_typeof(payload->'profiles'->'assessment') = 'object', false)
    and coalesce(jsonb_typeof(payload->'profiles'->'assessment'->'selectedContaminants') = 'array', false)
    and coalesce(jsonb_typeof(payload->'profiles'->'assessment'->'apecs') = 'array', false)
    and octet_length(payload::text) <= 262144
  ),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_assessments_owner_updated on public.saved_assessments(user_id, updated_at desc);
alter table public.saved_assessments enable row level security;
revoke all on public.saved_assessments from public, anon, authenticated;
grant select, delete on public.saved_assessments to authenticated;
grant insert (user_id, title, payload), update (title, payload) on public.saved_assessments to authenticated;
create policy "Read own assessments" on public.saved_assessments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Save own assessments" on public.saved_assessments for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own assessments" on public.saved_assessments for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own assessments" on public.saved_assessments for delete to authenticated
  using ((select auth.uid()) = user_id);
create function public.stamp_saved_assessment() returns trigger language plpgsql
  set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.stamp_saved_assessment() from public, anon, authenticated;
create trigger stamp_saved_assessment before update on public.saved_assessments
  for each row execute function public.stamp_saved_assessment();
commit;
