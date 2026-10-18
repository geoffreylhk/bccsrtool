begin;
-- Keep the existing RPC argument name for compatibility with the first installation.
create or replace function public.delete_own_account(confirmation_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  expected_email text;
begin
  if caller is null or not exists (
    select 1 from auth.sessions s
    where s.user_id = caller and s.id::text = (auth.jwt()->>'session_id')
  ) then
    raise exception 'Sign in again before deleting your account.' using errcode = '42501';
  end if;
  select u.email into expected_email from auth.users u
    where u.id = caller for update of u;
  if expected_email is null or confirmation_name is distinct from expected_email then
    raise exception 'The email address does not match. Your account has not been deleted.' using errcode = '22023';
  end if;
  delete from auth.sessions where user_id = caller;
  delete from auth.users where id = caller;
end;
$$;
revoke all on function public.delete_own_account(text) from public, anon;
grant execute on function public.delete_own_account(text) to authenticated;
commit;
