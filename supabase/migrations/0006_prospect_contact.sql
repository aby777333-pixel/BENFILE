-- 0006: optional contact details captured when a prospect is created (before any verification run).
-- Masked + hashed on the client row; the full value lives only in sensitive_values (audited reveal).
alter table clients
  add column if not exists contact_phone_masked text,
  add column if not exists contact_phone_hash text,
  add column if not exists contact_phone_sensitive_id uuid references sensitive_values(id) on delete set null,
  add column if not exists contact_email_masked text,
  add column if not exists contact_email_hash text,
  add column if not exists contact_email_sensitive_id uuid references sensitive_values(id) on delete set null;
create index if not exists clients_contact_phone_hash_idx on clients(contact_phone_hash) where contact_phone_hash is not null;
create index if not exists clients_contact_email_hash_idx on clients(contact_email_hash) where contact_email_hash is not null;

-- Hash search must also find prospects whose contact was captured without a run.
create or replace function find_clients_by_hash(p_kind text, p_hash text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct client_id from sensitive_values where kind = p_kind and value_hash = p_hash and has_perm('clients:read')
  union
  select id from clients where has_perm('clients:read') and ((p_kind = 'PHONE' and contact_phone_hash = p_hash) or (p_kind = 'EMAIL' and contact_email_hash = p_hash));
$$;
