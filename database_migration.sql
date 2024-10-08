-- Create a table for public profiles
create table profiles (
  id uuid references auth.users on delete cascade not null primary key,
  updated_at timestamp with time zone,
  full_name text,
  company_name text,
  avatar_url text,
  website text
);
-- Set up Row Level Security (RLS)
-- See https://supabase.com/docs/guides/auth/row-level-security for more details.
alter table profiles
  enable row level security;

create policy "Profiles are viewable by self." on profiles
  for select using (auth.uid() = id);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Create Stripe Customer Table
-- One stripe customer per user (PK enforced)
-- Limit RLS policies -- mostly only server side access
create table stripe_customers (
  user_id uuid references auth.users on delete cascade not null primary key,
  updated_at timestamp with time zone,
  stripe_customer_id text unique
);
alter table stripe_customers enable row level security;

-- Create a table for "Contact Us" form submissions
-- Limit RLS policies -- only server side access
create table contact_requests (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamp with time zone,
  first_name text,
  last_name text,
  email text,
  phone text,
  company_name text,
  message_body text
);
alter table contact_requests enable row level security;

-- This trigger automatically creates a profile entry when a new user signs up via Supabase Auth.
-- See https://supabase.com/docs/guides/auth/managing-user-data#using-triggers for more details.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Set up Storage!
insert into storage.buckets (id, name)
  values ('avatars', 'avatars');

-- Set up access controls for storage.
-- See https://supabase.com/docs/guides/storage#policy-examples for more details.
create policy "Avatar images are publicly accessible." on storage.objects
  for select using (bucket_id = 'avatars');

create policy "Anyone can upload an avatar." on storage.objects
  for insert with check (bucket_id = 'avatars');

-- Create invitations table
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token UUID NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security (RLS)
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to insert new invitations
CREATE POLICY "Users can create invitations" ON invitations
  FOR INSERT WITH CHECK (auth.uid() = invited_by);

-- Create policy to allow users to update invitations they've sent
CREATE POLICY "Users can update invitations they've sent" ON invitations
  FOR UPDATE USING (auth.uid() = invited_by);

-- Policy for authenticated users and unauthenticated access
CREATE POLICY "Anyone can read invitations with a valid token" ON invitations
FOR SELECT
USING (auth.uid() = invited_by OR auth.uid() IS NULL);

-- Policy specifically for unauthenticated access
CREATE POLICY "Unauthenticated users can read invitations with a valid token" ON invitations
FOR SELECT
TO public
USING (auth.uid() IS NULL);

-- Create index on email for faster lookups
CREATE INDEX idx_invitations_email ON invitations(email);

-- Create index on token for faster lookups
CREATE INDEX idx_invitations_token ON invitations(token);

CREATE OR REPLACE FUNCTION public.check_user_exists(email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM auth.users WHERE auth.users.email = $1); -- Specify auth.users.email
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add new columns
ALTER TABLE public.profiles
ADD COLUMN gender text null,
ADD COLUMN date_of_birth date null,
ADD COLUMN location text null;

create or replace function is_user_super_admin(user_id uuid)
returns boolean as $$
declare
  is_admin boolean;
begin
  select is_super_admin into is_admin from auth.users where id = user_id;
  return coalesce(is_admin, false);
end;
$$ language plpgsql security definer;

CREATE TABLE meditation_sessions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    duration INTEGER NOT NULL,
    method TEXT,
    comments TEXT,
    rating integer null,
    feedback text null,    
    start_ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_ts TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE meditation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_meditation_sessions_on_user_id
    ON meditation_sessions
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY insert_meditation_sessions_on_user_id
    ON meditation_sessions
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY update_meditation_sessions_on_user_id
    ON meditation_sessions
    FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY delete_meditation_sessions_on_user_id
    ON meditation_sessions
    FOR DELETE
    USING (user_id = auth.uid());

CREATE TABLE biometrics (
    ts TIMESTAMPTZ NOT NULL,
    meditation_id INTEGER NOT NULL,
    bpm FLOAT,
    brpm FLOAT,
    movement FLOAT,
    elapsed_seconds INTEGER
);

SELECT create_hypertable('biometrics', 'ts');

CREATE INDEX ON biometrics (meditation_id, ts DESC);

ALTER TABLE biometrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert biometrics for their meditation sessions" ON biometrics
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM meditation_sessions
    WHERE id = biometrics.meditation_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can view biometrics for their meditation sessions" ON biometrics
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM meditation_sessions
    WHERE id = biometrics.meditation_id AND user_id = auth.uid()
  )
);

CREATE TABLE meditation_instructions (
    id BIGINT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    meditation_id BIGINT NOT NULL,
    elapsed_seconds INTEGER NOT NULL,
    instruction TEXT NOT NULL,
    play_ts TIMESTAMPTZ,
    PRIMARY KEY (id, ts)
);

ALTER TABLE "public"."meditation_instructions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access"
ON "public"."meditation_instructions"
FOR SELECT
TO anon
USING (true);

CREATE INDEX ON meditation_instructions (meditation_id, ts DESC);

CREATE POLICY insert_meditation_instructions_on_user_id
    ON meditation_instructions
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY public_select ON public.meditation_instructions
FOR SELECT
USING (true);    

CREATE POLICY "allow_update_meditation_instructions_by_meditation_id" 
ON "public"."meditation_instructions"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  meditation_id IN (
    SELECT id 
    FROM meditation_sessions 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  meditation_id IN (
    SELECT id 
    FROM meditation_sessions 
    WHERE user_id = auth.uid()
  )
);

ALTER TABLE public.meditation_instructions
ADD CONSTRAINT fk_meditation_session
FOREIGN KEY (meditation_id) 
REFERENCES public.meditation_sessions(id);

ALTER TABLE public.biometrics
ADD CONSTRAINT fk_meditation_session
FOREIGN KEY (meditation_id) 
REFERENCES public.meditation_sessions(id);

create table chat_history (
  id serial primary key,
  meditation_id integer not null,
  user_message text not null,
  ai_message text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on the chat_history table
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Policy for reading chat history
CREATE POLICY read_own_chat_history ON chat_history
FOR SELECT
USING (
  meditation_id IN (
    SELECT id 
    FROM meditation_sessions 
    WHERE user_id = auth.uid()
  )
);

-- Policy for inserting chat history
CREATE POLICY insert_own_chat_history ON chat_history
FOR INSERT
WITH CHECK (
  meditation_id IN (
    SELECT id 
    FROM meditation_sessions 
    WHERE user_id = auth.uid()
  )
);
