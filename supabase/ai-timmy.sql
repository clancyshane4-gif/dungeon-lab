-- AI Timmy for paying clients. Run once in Supabase > SQL Editor. Safe to run again.

-- Who has AI Timmy switched on.
alter table public.profiles add column if not exists ai_access boolean not null default false;

-- Access codes can now unlock AI Timmy too. Give mentorship buyers a code with grants_ai = true.
alter table public.access_codes add column if not exists grants_ai boolean not null default false;

create or replace function public.redeem_code(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ai boolean;
begin
  if auth.uid() is null then return false; end if;
  select grants_ai into ai from public.access_codes where lower(code) = lower(trim(p_code)) and active;
  if not found then return false; end if;
  update public.profiles set has_access = true, ai_access = (ai_access or ai) where id = auth.uid();
  return true;
end $$;
revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

-- Daily message counter, so one client can't run up the bill.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ai_usage' and policyname = 'read own usage') then
    create policy "read own usage" on public.ai_usage for select using (user_id = auth.uid());
  end if;
end $$;

create or replace function public.bump_ai_usage() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.ai_usage (user_id, day, count)
    values (auth.uid(), (now() at time zone 'America/New_York')::date, 1)
    on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    returning count into n;
  return n;
end $$;
revoke all on function public.bump_ai_usage() from public, anon;
grant execute on function public.bump_ai_usage() to authenticated;

-- The mentorship code. Change MENTOR-DUNGEON to whatever the coaches give buyers.
insert into public.access_codes (code, note, grants_ai) values ('MENTOR-DUNGEON', 'Mentorship clients: Lab plus AI Timmy', true)
  on conflict (code) do update set grants_ai = true;
