-- 0009: the owner's decision (2026-10-14): a self-declared Aadhaar number is sealed in full like every
-- other identifier (masked on the record, audited reveal). Consent terms bumped to 2026-10-14 so Part A
-- no longer promises "no storage of your Aadhaar number". Only portal_declare_details changes.

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

  -- Identifiers: masked + hashed, full value sealed (Aadhaar included, per owner decision 2026-10-14)
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
    v_id := bf_declare(v_client, v_sub, r.kind, r.label, v_mask, v_hash, v_norm, v_detail);
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
