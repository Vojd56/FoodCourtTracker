-- ============================================================
-- Food Court Tracker — Forum Nová Karolina Ostrava
-- Databázové schéma pro Vercel + Supabase (PostgreSQL)
--
-- Nevyžaduje hesla ani registrace — funguje okamžitě pro partu přátel!
-- Výchozí osoby: Vojta, Peťa, Adél + možnost přidání dalších.
-- ============================================================

-- 1. Tabulka členů / osob (Vojta, Peťa, Adél + noví)
CREATE TABLE IF NOT EXISTS public.members (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text DEFAULT '#3b8559',
  logo text DEFAULT '🍔',
  created_at timestamptz DEFAULT now()
);

-- 2. Tabulka návštěv a recenzí (každý člen má svůj záznam k podniku)
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  author_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  visited boolean DEFAULT true,
  rating integer CHECK (rating >= 0 AND rating <= 5) DEFAULT 0,
  note text DEFAULT '',
  visit_date text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT reviews_venue_author_unique UNIQUE (venue_id, author_id)
);

-- Indexy pro bleskové načítání
CREATE INDEX IF NOT EXISTS idx_reviews_venue_id ON public.reviews(venue_id);
CREATE INDEX IF NOT EXISTS idx_reviews_author_id ON public.reviews(author_id);
CREATE INDEX IF NOT EXISTS idx_reviews_visited ON public.reviews(visited);

-- 3. Výchozí osoby: Vojta, Peťa, Adél
INSERT INTO public.members (id, name, color, logo)
VALUES
  ('vojta', 'Vojta', '#6b8e23', '👑'),
  ('peta', 'Peťa', '#0891b2', '🍕'),
  ('adel', 'Adél', '#9333ea', '✨')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  color = EXCLUDED.color,
  logo = EXCLUDED.logo;

-- 4. Povolení čtení i zápisu pro anonymní návštěvníky (bez nutnosti přihlašování)
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for members" ON public.members;
CREATE POLICY "Allow all for members" ON public.members
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for reviews" ON public.reviews;
CREATE POLICY "Allow all for reviews" ON public.reviews
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.members TO anon, authenticated;
GRANT ALL ON public.reviews TO anon, authenticated;
