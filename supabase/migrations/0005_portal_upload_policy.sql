-- 0005: portal uploads must work regardless of whether the browser also carries a staff session.
-- The token-in-path check is the real guard; the JWT role is incidental. Previously the policy was
-- anon-only, so a staff member testing a portal link in their own browser (role = authenticated)
-- hit "new row violates row-level security policy".
alter policy "portal upload" on storage.objects to anon, authenticated;
