-- Apply after saved-assessments.sql. Existing assessments are preserved.
begin;
create schema if not exists bccsr_private;
revoke all on schema bccsr_private from public, anon, authenticated;

create table bccsr_private.assessment_write_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  write_count integer not null check (write_count > 0)
);
alter table bccsr_private.assessment_write_limits enable row level security;
revoke all on bccsr_private.assessment_write_limits from public, anon, authenticated;

-- Definer access is needed only for the private counter; callers cannot change it.
create function bccsr_private.enforce_assessment_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  request_time timestamptz := clock_timestamp();
  writes integer;
begin
  if auth.uid() is null or auth.uid() is distinct from new.user_id then
    raise insufficient_privilege using message = 'Assessment owner does not match the signed-in user.';
  end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise insufficient_privilege using message = 'Assessment ownership cannot change.';
  end if;

  -- The counter row lock also serializes concurrent inserts for the account quota.
  insert into bccsr_private.assessment_write_limits as limits (user_id, window_start, write_count)
  values (new.user_id, request_time, 1)
  on conflict (user_id) do update set
    window_start = case when limits.window_start <= request_time - interval '1 minute' then request_time else limits.window_start end,
    write_count = case when limits.window_start <= request_time - interval '1 minute' then 1 else limits.write_count + 1 end
  returning write_count into writes;
  if writes > 20 then
    raise sqlstate 'PT429' using message = 'Assessment save rate limit reached. Wait a minute and try again.';
  end if;

  if tg_op = 'INSERT' and (select count(*) from public.saved_assessments where user_id = new.user_id) >= 100 then
    raise sqlstate 'PT409' using message = 'The account already has 100 saved assessments. Delete an unused assessment before saving a new one.';
  end if;
  return new;
end;
$$;
revoke all on function bccsr_private.enforce_assessment_limits() from public, anon, authenticated;
create trigger enforce_assessment_limits before insert or update on public.saved_assessments
  for each row execute function bccsr_private.enforce_assessment_limits();
commit;
