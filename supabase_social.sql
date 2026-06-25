-- Supabase SQL to create social schema, watchlist status constraint, and RLS policies

-- 1) Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  username text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- 2) Friends table to represent friend relationships and requests
CREATE TABLE IF NOT EXISTS friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (requester, receiver)
);

-- 3) Watch groups
CREATE TABLE IF NOT EXISTS watch_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 4) Group members
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES watch_groups(id) ON DELETE CASCADE,
  member uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  UNIQUE (group_id, member)
);

-- 5) Group chats
CREATE TABLE IF NOT EXISTS group_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES watch_groups(id) ON DELETE CASCADE,
  sender uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- 6) Ensure watchlist.status uses allowed values
-- If your watchlist table exists and has a status column, adjust it; otherwise this creates the check
-- Alter the column and add the constraint only if the table and column exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'watchlist') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'watchlist' AND column_name = 'status') THEN
      -- Ensure the column is text (safe coercion)
      EXECUTE 'ALTER TABLE public.watchlist ALTER COLUMN status SET DATA TYPE text USING status::text';

      -- Add check constraint only if it doesn't already exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
        WHERE c.contype = ''c'' AND t.relname = ''watchlist'' AND c.conname = ''watchlist_status_check''
      ) THEN
        EXECUTE 'ALTER TABLE public.watchlist ADD CONSTRAINT watchlist_status_check CHECK (status IN (''planning_to_watch'',''watching'',''completed'',''on_hold'',''dropped''))';
      END IF;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 7) Enable RLS and policies for profiles, friends, group_members, watchlist, group_chats
-- Profiles: user can insert their own profile and select others
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- allow authenticated users to insert their profile (owner = auth.uid())
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (auth.role() IS NOT NULL AND id = auth.uid());

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (true);

-- Friends: enable RLS
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS friends_insert ON friends;
CREATE POLICY friends_insert ON friends FOR INSERT WITH CHECK (auth.role() IS NOT NULL AND requester = auth.uid());

DROP POLICY IF EXISTS friends_select ON friends;
CREATE POLICY friends_select ON friends FOR SELECT USING (requester = auth.uid() OR receiver = auth.uid());

DROP POLICY IF EXISTS friends_update ON friends;
CREATE POLICY friends_update ON friends FOR UPDATE USING (requester = auth.uid() OR receiver = auth.uid()) WITH CHECK (true);

DROP POLICY IF EXISTS friends_delete ON friends;
CREATE POLICY friends_delete ON friends FOR DELETE USING (requester = auth.uid() OR receiver = auth.uid());

-- Watch_groups and group_members
ALTER TABLE watch_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS watch_groups_insert ON watch_groups;
CREATE POLICY watch_groups_insert ON watch_groups FOR INSERT WITH CHECK (owner = auth.uid());

DROP POLICY IF EXISTS watch_groups_select ON watch_groups;
CREATE POLICY watch_groups_select ON watch_groups FOR SELECT USING (auth.role() IS NOT NULL);

DROP POLICY IF EXISTS watch_groups_delete ON watch_groups;
CREATE POLICY watch_groups_delete ON watch_groups FOR DELETE USING (owner = auth.uid());

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS group_members_insert ON group_members;
CREATE POLICY group_members_insert ON group_members FOR INSERT WITH CHECK (member = auth.uid());

DROP POLICY IF EXISTS group_members_select ON group_members;
CREATE POLICY group_members_select ON group_members FOR SELECT USING (auth.role() IS NOT NULL);

DROP POLICY IF EXISTS group_members_delete ON group_members;
CREATE POLICY group_members_delete ON group_members FOR DELETE USING (member = auth.uid());

-- Group_chats: allow members to insert messages for groups they belong to
ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS group_chats_insert ON group_chats;
CREATE POLICY group_chats_insert ON group_chats FOR INSERT WITH CHECK (
  sender = auth.uid() AND exists (select 1 from group_members gm where gm.group_id = group_chats.group_id and gm.member = auth.uid())
);

-- Allow selecting group_chats if you're a member
DROP POLICY IF EXISTS group_chats_select ON group_chats;
CREATE POLICY group_chats_select ON group_chats FOR SELECT USING (
  exists (select 1 from group_members gm where gm.group_id = group_chats.group_id and gm.member = auth.uid())
);

-- Allow watchlist operations: only owner may modify
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS watchlist_select ON watchlist;
CREATE POLICY watchlist_select ON watchlist FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS watchlist_insert ON watchlist;
CREATE POLICY watchlist_insert ON watchlist FOR INSERT WITH CHECK (auth.role() IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS watchlist_update ON watchlist;
CREATE POLICY watchlist_update ON watchlist FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS watchlist_delete ON watchlist;
CREATE POLICY watchlist_delete ON watchlist FOR DELETE USING (user_id = auth.uid());

-- Optional: create an index to speed up lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles USING btree (lower(username));
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);

-- 8) Add columns to watchlist to support show tracking
ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'movie';
ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS season integer DEFAULT 1;
ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS episode integer DEFAULT 1;

-- 9) Create table to track individual watched episodes
CREATE TABLE IF NOT EXISTS public.user_watched_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES public.watchlist(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tmdb_show_id integer NOT NULL,
  season_number integer NOT NULL,
  episode_number integer NOT NULL,
  watched_at timestamptz DEFAULT now(),
  CONSTRAINT unique_user_episode UNIQUE (user_id, tmdb_show_id, season_number, episode_number)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_watched_episodes ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS user_watched_episodes_select ON public.user_watched_episodes;
CREATE POLICY user_watched_episodes_select ON public.user_watched_episodes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_watched_episodes_insert ON public.user_watched_episodes;
CREATE POLICY user_watched_episodes_insert ON public.user_watched_episodes
  FOR INSERT WITH CHECK (auth.uid() = user_id AND auth.role() IS NOT NULL);

DROP POLICY IF EXISTS user_watched_episodes_delete ON public.user_watched_episodes;
CREATE POLICY user_watched_episodes_delete ON public.user_watched_episodes
  FOR DELETE USING (auth.uid() = user_id);

-- Notes:
-- Run this in Supabase SQL editor. Ensure the "pgcrypto" extension is enabled for gen_random_uuid() or replace with uuid_generate_v4().

-- 10) Add completed_at column to watchlist to track exactly when an item was completed
ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS completed_at timestamptz;
