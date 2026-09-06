ALTER TABLE requests ADD COLUMN region TEXT NOT NULL DEFAULT 'home';
CREATE INDEX idx_requests_region_created ON requests(region, created_at);
