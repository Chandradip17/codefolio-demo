-- Idea Assistant: keep the "why it fits this hackathon" section on saved ideas.
-- Additive only (existing rows get an empty string).
alter table public.hackathon_ideas
  add column if not exists why_it_fits text not null default '' check (char_length(why_it_fits) <= 1500);
