CREATE INDEX IF NOT EXISTS idx_requests_org_status_created ON requests(org_id, status, created_at);
