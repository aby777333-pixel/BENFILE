-- 0007: when a live connector replaces a sandbox connector, that sandbox's pending findings are
-- retired as SUPERSEDED (not rejected - they were never real) so the review queue only holds live records.
alter type finding_review add value if not exists 'SUPERSEDED';
