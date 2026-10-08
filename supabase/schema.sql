-- Dungeon Lab database. Paste this whole file into Supabase > SQL Editor > New query, then Run. Run it once.
-- Every table is locked so a customer can only ever see and change their own rows.

-- ---------- Profiles and access ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  has_access boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Access codes your coaches hand out on the call. No customer can read this table.
create table public.access_codes (
  code text primary key,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.access_codes enable row level security;

create function public.redeem_code(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.access_codes where lower(code) = lower(trim(p_code)) and active) then
    update public.profiles set has_access = true where id = auth.uid();
    return true;
  end if;
  return false;
end $$;
revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

create function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select has_access from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.has_access() from public, anon;
grant execute on function public.has_access() to authenticated;

-- ---------- Trading data ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  firm text,
  account_size numeric,
  stage text not null default 'Evaluation',
  start_date date,
  profit_target numeric,
  max_drawdown numeric,
  drawdown_type text default 'Trailing',
  daily_loss_limit numeric,
  consistency_rule_pct numeric,
  min_trading_days integer,
  starting_balance numeric,
  adjustment numeric,
  payout_threshold numeric,
  last_payout_date date,
  status_notes text,
  closed_date date,
  created_at timestamptz not null default now()
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid not null references public.accounts on delete cascade,
  date date not null,
  instrument text,
  point_value numeric,
  direction text,
  contracts numeric,
  entry_price numeric,
  stop_price numeric,
  exit_price numeric,
  pnl numeric,
  risk numeric,
  r_multiple numeric,
  setup_grade text,
  session text,
  model text,
  emotion text,
  followed_plan boolean,
  notes text,
  screenshot_path text,
  created_at timestamptz not null default now()
);
create index trades_user_date on public.trades (user_id, date);

-- Scorecards, lessons, preps, debriefs, weekly reviews, news events, the trading plan and the editable reference tables.
create table public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index records_user_kind on public.records (user_id, kind);

alter table public.accounts enable row level security;
alter table public.trades enable row level security;
alter table public.records enable row level security;
create policy "own accounts" on public.accounts for all using (user_id = auth.uid() and public.has_access()) with check (user_id = auth.uid() and public.has_access());
create policy "own trades" on public.trades for all using (user_id = auth.uid() and public.has_access()) with check (user_id = auth.uid() and public.has_access());
create policy "own records" on public.records for all using (user_id = auth.uid() and public.has_access()) with check (user_id = auth.uid() and public.has_access());

-- ---------- Chart screenshots (private, one folder per customer) ----------
insert into storage.buckets (id, name, public) values ('screens', 'screens', false) on conflict (id) do nothing;
create policy "own screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'screens' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own screenshots write" on storage.objects for insert to authenticated
  with check (bucket_id = 'screens' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own screenshots delete" on storage.objects for delete to authenticated
  using (bucket_id = 'screens' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- AI Timmy (paying clients) ----------
-- See ai-timmy.sql. It is also safe to run on a fresh project after this file.

-- ---------- Your first access code ----------
-- Change DUNGEON to whatever your coaches will say on the call. Add more rows any time in Table Editor > access_codes.
insert into public.access_codes (code, note) values ('DUNGEON', 'Launch code');
