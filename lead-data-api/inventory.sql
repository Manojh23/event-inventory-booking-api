CREATE TABLE IF NOT EXISTS venues (
  id text PRIMARY KEY, name text NOT NULL, city text NOT NULL, region text NOT NULL,
  segments text[] NOT NULL, capacity integer NOT NULL CHECK (capacity > 0),
  base_cents integer NOT NULL CHECK (base_cents > 0), amenities text[] NOT NULL,
  description text NOT NULL
);
CREATE TABLE IF NOT EXISTS venue_days (
  venue_id text REFERENCES venues(id), day date NOT NULL,
  PRIMARY KEY (venue_id, day)
);
CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY, lead_id uuid NOT NULL REFERENCES leads(id), request_key uuid NOT NULL,
  lead_version integer NOT NULL, venue_id text NOT NULL, day date NOT NULL,
  guests integer NOT NULL CHECK(guests BETWEEN 1 AND 1000),
  addons text[] NOT NULL, total_cents integer NOT NULL CHECK(total_cents>0),
  status text NOT NULL CHECK(status IN ('held','booked','released','expired')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(venue_id, day) REFERENCES venue_days(venue_id, day),
  UNIQUE(lead_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS exclusive_venue_day ON proposals(venue_id, day)
  WHERE status IN ('held','booked');
CREATE INDEX IF NOT EXISTS proposals_lead ON proposals(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_expiry ON proposals(expires_at) WHERE status='held';
INSERT INTO venues VALUES
 ('harbor-hall','Harbor Hall','Boston','MA',ARRAY['corporate','wedding','community'],220,580000,ARRAY['av','catering','parking'],'Waterfront hall with stage, breakouts, and transit access.'),
 ('cedar-loft','Cedar Loft','Salem','MA',ARRAY['corporate','wedding','community'],110,320000,ARRAY['av','catering'],'Intimate event loft with harbor views and in-house catering.'),
 ('quay-pavilion','Quay Pavilion','Gloucester','MA',ARRAY['wedding','community'],160,420000,ARRAY['catering','parking'],'Covered pavilion with lawn and onsite parking.'),
 ('pier-club','Pier Club','Newport','RI',ARRAY['marine','corporate'],85,280000,ARRAY['parking'],'Marina clubhouse for charter gatherings and small receptions.'),
 ('bay-marina','Bay Marina','Marblehead','MA',ARRAY['marine'],65,215000,ARRAY['parking'],'Marina event berth and dockside reception space.'),
 ('fern-center','Fern Center','Providence','RI',ARRAY['corporate','wedding'],190,470000,ARRAY['av','catering','parking'],'Conference space with breakout rooms and onsite catering.')
ON CONFLICT DO NOTHING;
INSERT INTO venue_days(venue_id,day)
 SELECT v.id,CURRENT_DATE + d.n FROM venues v
 CROSS JOIN generate_series(1,45) d(n)
 WHERE v.id <> 'harbor-hall' OR d.n % 2 <> 0
ON CONFLICT DO NOTHING;
