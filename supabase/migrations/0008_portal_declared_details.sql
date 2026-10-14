-- 0008: the person may type their own details on the portal (every field optional): name as on PAN,
-- date of birth, PAN, Aadhaar, passport, voter ID, driving licence, mobiles, e-mails, current and
-- permanent address. Identifiers are stored exactly like ingested ones - masked + hashed on the
-- record, full value sealed in sensitive_values (audited reveal). Aadhaar is the exception: last four
-- digits and hash only; the full number is never stored. Nothing is accepted before Part A consent.
-- Everything stays CLIENT DECLARED until a provider / ownership check confirms it.

create table if not exists client_declarations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  submission_id uuid references portal_submissions(id) on delete set null,
  kind text not null,                        -- NAME | DOB | PAN | AADHAAR | PASSPORT | VOTER_ID | DRIVING_LICENCE | PHONE | EMAIL | ADDRESS
  label text not null default 'PRIMARY',     -- PRIMARY | ALTERNATE | CURRENT | PERMANENT
  value_display text not null,               -- masked identifier; plain value for name / date of birth / address
  value_hash text,
  sensitive_value_id uuid references sensitive_values(id) on delete set null,
  detail jsonb not null default '{}',        -- structured parts (address lines, passport expiry)
  status text not null default 'DECLARED',   -- DECLARED | REJECTED | SUPERSEDED
  declared_via text not null default 'CLIENT_PORTAL',
  declared_at timestamptz not null default now(),
  reviewed_by uuid references staff_profiles(user_id),
  reviewed_at timestamptz
);
create index if not exists client_declarations_client_idx on client_declarations(client_id, declared_at desc);
create index if not exists client_declarations_hash_idx on client_declarations(kind, value_hash) where value_hash is not null;
alter table client_declarations enable row level security;
drop policy if exists client_declarations_read on client_declarations;
create policy client_declarations_read on client_declarations for select using (has_perm('clients:read'));
drop policy if exists client_declarations_update on client_declarations;
create policy client_declarations_update on client_declarations for update using (has_perm('clients:write'));

-- Hash search also finds a client by a self-declared identifier.
create or replace function find_clients_by_hash(p_kind text, p_hash text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct client_id from sensitive_values where kind = p_kind and value_hash = p_hash and has_perm('clients:read')
  union
  select id from clients where has_perm('clients:read') and ((p_kind = 'PHONE' and contact_phone_hash = p_hash) or (p_kind = 'EMAIL' and contact_email_hash = p_hash))
  union
  select client_id from client_declarations where kind = p_kind and value_hash = p_hash and status <> 'REJECTED' and has_perm('clients:read');
$$;

-- Normalisation / hashing / masking mirror src/lib/security/masking.ts so a declared value and an
-- ingested value of the same identifier produce the same hash and the same mask.
create or replace function bf_normalize_identifier(p_kind text, p_raw text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p_raw is null then return null; end if;
  if p_kind = 'PHONE' then
    d := regexp_replace(p_raw, '\D', '', 'g');
    if length(d) > 10 and d like '91%' then d := right(d, 10);
    elsif length(d) = 11 and d like '0%' then d := substr(d, 2);
    end if;
    return nullif(d, '');
  elsif p_kind = 'EMAIL' then
    return nullif(lower(btrim(p_raw)), '');
  else
    return nullif(upper(regexp_replace(p_raw, '[\s\-.()]', '', 'g')), '');
  end if;
end $$;

create or replace function bf_identifier_hash(p_kind text, p_norm text) returns text
language sql immutable as $$
  select case when p_norm is null then null else encode(extensions.digest(p_kind || ':' || p_norm, 'sha256'), 'hex') end
$$;

create or replace function bf_mask_identifier(p_kind text, p_norm text) returns text
language sql immutable as $$
  select case p_kind
    when 'PAN' then case when length(p_norm) = 10 then substr(p_norm, 1, 4) || '*****' || substr(p_norm, 10, 1)
                        else substr(p_norm, 1, 2) || repeat('*', greatest(length(p_norm) - 3, 0)) || right(p_norm, 1) end
    when 'AADHAAR' then 'XXXX XXXX ' || right(p_norm, 4)
    when 'PASSPORT' then substr(p_norm, 1, 2) || repeat('*', greatest(length(p_norm) - 4, 2)) || right(p_norm, 2)
    when 'PHONE' then substr(p_norm, 1, 2) || 'XXXXX' || right(p_norm, 3)
    when 'EMAIL' then substr(split_part(p_norm, '@', 1), 1, least(2, length(split_part(p_norm, '@', 1))))
                      || repeat('*', greatest(length(split_part(p_norm, '@', 1)) - least(2, length(split_part(p_norm, '@', 1))), 3))
                      || '@' || split_part(p_norm, '@', 2)
    else case when length(p_norm) <= 4 then repeat('*', length(p_norm))
              else substr(p_norm, 1, 2) || repeat('*', length(p_norm) - 4) || right(p_norm, 2) end
  end
$$;

-- Format rules; the message is shown to the person as typed, so it starts with "Please".
create or replace function bf_check_identifier(p_kind text, p_norm text) returns void
language plpgsql immutable as $$
begin
  if p_kind = 'PAN' and p_norm !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Please check the PAN - it should look like ABCDE1234F.'; end if;
  if p_kind = 'AADHAAR' and p_norm !~ '^[2-9][0-9]{11}$' then raise exception 'Please check the Aadhaar number - it should be 12 digits.'; end if;
  if p_kind = 'PASSPORT' and p_norm !~ '^[A-Z0-9]{6,12}$' then raise exception 'Please check the passport number.'; end if;
  if p_kind = 'VOTER_ID' and p_norm !~ '^[A-Z]{3}[0-9]{7}$' then raise exception 'Please check the voter ID - it should look like ABC1234567.'; end if;
  if p_kind = 'DRIVING_LICENCE' and p_norm !~ '^[A-Z]{2}[0-9A-Z]{9,15}$' then raise exception 'Please check the driving licence number.'; end if;
  if p_kind = 'PHONE' and p_norm !~ '^[6-9][0-9]{9}$' then raise exception 'Please check the mobile number - a 10-digit Indian mobile is expected.'; end if;
  if p_kind = 'EMAIL' and (p_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(p_norm) > 160) then raise exception 'Please check the e-mail address.'; end if;
end $$;

-- Record one declared item. Returns the new row id, or null when the identical value is already on
-- file (same hash, or same text for non-identifiers). An earlier different value of the same kind
-- and label is marked SUPERSEDED. The full value (when given) is sealed in sensitive_values.
create or replace function bf_declare(p_client uuid, p_submission uuid, p_kind text, p_label text, p_display text, p_hash text, p_full text, p_detail jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sid uuid;
begin
  if exists (select 1 from client_declarations d where d.client_id = p_client and d.kind = p_kind and d.label = p_label and d.status = 'DECLARED'
             and ((p_hash is not null and d.value_hash = p_hash) or (p_hash is null and d.value_display = p_display))) then
    return null;
  end if;
  update client_declarations set status = 'SUPERSEDED' where client_id = p_client and kind = p_kind and label = p_label and status = 'DECLARED';
  if p_full is not null then
    insert into sensitive_values (client_id, run_id, kind, entity_table, field_key, value_full, value_hash)
    values (p_client, null, p_kind, 'client_declarations', lower(p_kind) || '_' || lower(p_label), p_full, p_hash)
    returning id into v_sid;
  end if;
  insert into client_declarations (client_id, submission_id, kind, label, value_display, value_hash, sensitive_value_id, detail)
  values (p_client, p_submission, p_kind, p_label, p_display, p_hash, v_sid, coalesce(p_detail, '{}'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function bf_declare(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;

-- Portal RPC: the person declares their own details. Requires an in-force consent (Part A or B).
create or replace function portal_declare_details(p_token text, p_payload jsonb, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_token uuid; v_sub uuid; v_consent text;
  v_declared text[] := '{}'; v_unchanged text[] := '{}'; v_summary jsonb := '{}';
  v_raw text; v_norm text; v_hash text; v_mask text; v_id uuid; v_sid uuid; v_detail jsonb; v_dob date; v_exp date;
  v_line1 text; v_line2 text; v_city text; v_state text; v_pin text; v_country text; v_full text; v_label text;
  r record;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then raise exception 'invalid or expired link'; end if;
  select consent_status into v_consent from clients where id = v_client;
  if v_consent is distinct from 'GRANTED' then raise exception 'Please accept Part A consent before sharing your details.'; end if;
  select id into v_token from portal_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  insert into portal_submissions (client_id, token_id, kind, payload) values (v_client, v_token, 'DETAILS', '{}') returning id into v_sub;

  -- Name as on PAN
  v_raw := left(nullif(btrim(coalesce(p_payload->>'full_name', '')), ''), 120);
  if v_raw is not null then
    if bf_declare(v_client, v_sub, 'NAME', 'PRIMARY', v_raw, null, null, '{}') is not null then v_declared := array_append(v_declared, 'full_name'); else v_unchanged := array_append(v_unchanged, 'full_name'); end if;
    v_summary := v_summary || jsonb_build_object('full_name', v_raw);
  end if;

  -- Date of birth
  v_raw := nullif(btrim(coalesce(p_payload->>'dob', '')), '');
  if v_raw is not null then
    if v_raw !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Please check the date of birth.'; end if;
    begin v_dob := v_raw::date; exception when others then raise exception 'Please check the date of birth.'; end;
    if v_dob > current_date or v_dob < date '1900-01-01' then raise exception 'Please check the date of birth.'; end if;
    if bf_declare(v_client, v_sub, 'DOB', 'PRIMARY', v_raw, null, null, '{}') is not null then v_declared := array_append(v_declared, 'dob'); else v_unchanged := array_append(v_unchanged, 'dob'); end if;
    v_summary := v_summary || jsonb_build_object('dob', v_raw);
  end if;

  -- Identifiers: masked + hashed, full value sealed (never for Aadhaar)
  for r in select * from (values
      ('pan', 'PAN', 'PRIMARY'), ('aadhaar', 'AADHAAR', 'PRIMARY'), ('passport', 'PASSPORT', 'PRIMARY'),
      ('voter_id', 'VOTER_ID', 'PRIMARY'), ('driving_licence', 'DRIVING_LICENCE', 'PRIMARY'),
      ('phone', 'PHONE', 'PRIMARY'), ('phone_alt', 'PHONE', 'ALTERNATE'),
      ('email', 'EMAIL', 'PRIMARY'), ('email_alt', 'EMAIL', 'ALTERNATE')) as t(key, kind, label)
  loop
    v_raw := nullif(btrim(coalesce(p_payload->>r.key, '')), '');
    if v_raw is null then continue; end if;
    v_norm := bf_normalize_identifier(r.kind, v_raw);
    if v_norm is null then continue; end if;
    perform bf_check_identifier(r.kind, v_norm);
    v_hash := bf_identifier_hash(r.kind, v_norm);
    v_mask := bf_mask_identifier(r.kind, v_norm);
    v_detail := '{}';
    if r.kind = 'PASSPORT' and coalesce(p_payload->>'passport_expiry', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin v_exp := (p_payload->>'passport_expiry')::date; v_detail := jsonb_build_object('expiry', p_payload->>'passport_expiry'); exception when others then v_detail := '{}'; end;
    end if;
    v_id := bf_declare(v_client, v_sub, r.kind, r.label, v_mask, v_hash, case when r.kind = 'AADHAAR' then null else v_norm end, v_detail);
    if v_id is not null then v_declared := array_append(v_declared, r.key); else v_unchanged := array_append(v_unchanged, r.key); end if;
    v_summary := v_summary || jsonb_build_object(r.key, v_mask);
    -- The primary mobile / e-mail also fills the declared contact on the client row when it is empty.
    if v_id is not null and r.label = 'PRIMARY' and r.kind in ('PHONE', 'EMAIL') then
      select sensitive_value_id into v_sid from client_declarations where id = v_id;
      if r.kind = 'PHONE' then
        update clients set contact_phone_masked = coalesce(contact_phone_masked, v_mask), contact_phone_hash = coalesce(contact_phone_hash, v_hash), contact_phone_sensitive_id = coalesce(contact_phone_sensitive_id, v_sid) where id = v_client;
      else
        update clients set contact_email_masked = coalesce(contact_email_masked, v_mask), contact_email_hash = coalesce(contact_email_hash, v_hash), contact_email_sensitive_id = coalesce(contact_email_sensitive_id, v_sid) where id = v_client;
      end if;
    end if;
  end loop;

  -- Addresses (current; permanent either "same as current" or its own fields)
  for v_label in select unnest(array['CURRENT', 'PERMANENT']) loop
    if v_label = 'CURRENT' or coalesce(p_payload->>'permanent_same', '') in ('yes', 'true', 'on') then
      v_line1 := left(nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''), 160);
      v_line2 := left(nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''), 160);
      v_city := left(nullif(btrim(coalesce(p_payload->>'address_city', '')), ''), 80);
      v_state := left(nullif(btrim(coalesce(p_payload->>'address_state', '')), ''), 80);
      v_pin := nullif(regexp_replace(coalesce(p_payload->>'address_pin', ''), '\s', '', 'g'), '');
      v_country := left(nullif(btrim(coalesce(p_payload->>'address_country', '')), ''), 60);
    else
      v_line1 := left(nullif(btrim(coalesce(p_payload->>'permanent_line1', '')), ''), 160);
      v_line2 := left(nullif(btrim(coalesce(p_payload->>'permanent_line2', '')), ''), 160);
      v_city := left(nullif(btrim(coalesce(p_payload->>'permanent_city', '')), ''), 80);
      v_state := left(nullif(btrim(coalesce(p_payload->>'permanent_state', '')), ''), 80);
      v_pin := nullif(regexp_replace(coalesce(p_payload->>'permanent_pin', ''), '\s', '', 'g'), '');
      v_country := left(nullif(btrim(coalesce(p_payload->>'permanent_country', '')), ''), 60);
    end if;
    if v_line1 is null and v_line2 is null and v_city is null and v_state is null and v_pin is null then continue; end if;
    if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'Please check the PIN code - 6 digits are expected.'; end if;
    v_full := concat_ws(', ', v_line1, v_line2, v_city, v_state, v_pin, coalesce(v_country, 'India'));
    v_detail := jsonb_strip_nulls(jsonb_build_object('line1', v_line1, 'line2', v_line2, 'city', v_city, 'state', v_state, 'pin', v_pin, 'country', coalesce(v_country, 'India')));
    if bf_declare(v_client, v_sub, 'ADDRESS', v_label, v_full, null, null, v_detail) is not null then v_declared := array_append(v_declared, ('address_' || lower(v_label))); else v_unchanged := array_append(v_unchanged, ('address_' || lower(v_label))); end if;
    v_summary := v_summary || jsonb_build_object('address_' || lower(v_label), v_full);
    if v_label = 'CURRENT' and v_city is not null then update clients set city = coalesce(city, v_city) where id = v_client; end if;
  end loop;

  if coalesce(array_length(v_declared, 1), 0) = 0 and coalesce(array_length(v_unchanged, 1), 0) = 0 then
    raise exception 'Please fill in at least one detail.';
  end if;

  -- The submission payload carries masked values only; full values live in sensitive_values.
  update portal_submissions set payload = jsonb_build_object('declared', to_jsonb(v_declared), 'unchanged', to_jsonb(v_unchanged), 'values', v_summary),
    status = case when coalesce(array_length(v_declared, 1), 0) = 0 then 'ACCEPTED' else 'PENDING_REVIEW' end,
    reviewed_at = case when coalesce(array_length(v_declared, 1), 0) = 0 then now() else null end
  where id = v_sub;

  insert into intelligence_events (client_id, event_type, title, detail, source_key)
  values (v_client, 'PORTAL_DECLARATION', 'Client declared personal details via portal',
          'Declared: ' || coalesce(array_to_string(v_declared, ', '), '-') || case when coalesce(array_length(v_unchanged, 1), 0) > 0 then '. Already on file: ' || array_to_string(v_unchanged, ', ') else '' end || '. Client declared - not verified.', 'CLIENT_PORTAL');

  insert into audit_logs (actor_id, actor_role, action, client_id, entity_table, entity_id, details, user_agent)
  values (null, null, 'portal.declare_details', v_client, 'portal_submissions', v_sub::text,
          jsonb_build_object('declared', to_jsonb(v_declared), 'unchanged', to_jsonb(v_unchanged)), left(coalesce(p_user_agent, ''), 300));

  return jsonb_build_object('submissionId', v_sub, 'declared', to_jsonb(v_declared), 'unchanged', to_jsonb(v_unchanged));
end $$;
grant execute on function portal_declare_details(text, jsonb, text) to anon, authenticated;

-- The portal shows what is on file (masked) so the person can see and update it.
create or replace function portal_context(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_out jsonb;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then return null; end if;
  update portal_tokens set last_used_at = now() where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  select jsonb_build_object(
    'clientId', c.id,
    'clientCode', c.client_code,
    'displayName', c.display_name,
    'consentStatus', c.consent_status,
    'documentRequests', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'documentType', d.document_type, 'reason', d.reason, 'status', d.status, 'requestedAt', d.requested_at)), '[]') from document_requests d where d.client_id = c.id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'docType', x.doc_type, 'title', x.title, 'status', x.status, 'uploadedAt', x.uploaded_at)), '[]') from client_documents x where x.client_id = c.id and x.upload_source = 'CLIENT_PORTAL'),
    'submissions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'createdAt', s.created_at)), '[]') from portal_submissions s where s.client_id = c.id),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'purpose', k.purpose, 'purposeCode', k.purpose_code, 'stage', k.stage, 'status', k.status, 'grantedAt', k.granted_at, 'expiresAt', k.expires_at, 'sources', k.sources_authorized, 'reference', k.consent_reference, 'capturedVia', k.captured_via) order by k.created_at desc), '[]') from consents k where k.client_id = c.id),
    'declarations', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'label', d.label, 'value', d.value_display, 'status', d.status, 'declaredAt', d.declared_at) order by d.declared_at desc), '[]') from client_declarations d where d.client_id = c.id and d.status = 'DECLARED')
  ) into v_out from clients c where c.id = v_client;
  return v_out;
end $$;
