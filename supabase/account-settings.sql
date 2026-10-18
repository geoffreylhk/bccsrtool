begin;
alter table public.profiles add column chemical_sort text not null default 'category'
  check (chemical_sort in ('category', 'default', 'alpha'));
grant select (chemical_sort), update (chemical_sort) on public.profiles to authenticated;

-- Elevated rights are needed only to remove the caller's own Auth account.
create function public.delete_own_account(confirmation_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  expected_name text;
begin
  if caller is null or not exists (
    select 1 from auth.sessions s
    where s.user_id = caller and s.id::text = (auth.jwt()->>'session_id')
  ) then
    raise exception 'Sign in again before deleting your account.' using errcode = '42501';
  end if;
  select coalesce(nullif(p.display_name, ''), u.email) into expected_name
    from auth.users u left join public.profiles p on p.id = u.id
    where u.id = caller for update of u;
  if expected_name is null or confirmation_name is distinct from expected_name then
    raise exception 'The username does not match. Your account has not been deleted.' using errcode = '22023';
  end if;
  -- Revoke refresh sessions and delete the account atomically; FK cascades remove its app data.
  delete from auth.sessions where user_id = caller;
  delete from auth.users where id = caller;
end;
$$;
revoke all on function public.delete_own_account(text) from public, anon;
grant execute on function public.delete_own_account(text) to authenticated;
commit;
