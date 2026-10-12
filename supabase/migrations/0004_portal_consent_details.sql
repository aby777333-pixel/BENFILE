-- 0004: Part A acceptance may carry the matching details the person chooses to give
-- (employer, city, date of birth, nominated public profile URLs). Stored with the acceptance
-- evidence; identifiers (PAN, phone, e-mail) are NOT collected here - they enter through the
-- verification ingest with hashing and masking.

drop function if exists portal_consent(text, text, text[], text, text, text);

create or replace function portal_consent(p_token text, p_stage text, p_sources text[], p_full_name text, p_user_agent text, p_terms_version text, p_details jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_token uuid; v_id uuid; v_code text; v_purpose text; v_days integer;
  v_allowed text[]; v_sources text[]; v_ref text; v_name text; v_details jsonb;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then raise exception 'invalid or expired link'; end if;
  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_name is null or length(v_name) < 3 then raise exception 'full name is required as signature'; end if;
  if p_stage = 'PRELIMINARY' then
    v_code := 'PRELIMINARY_SCREENING'; v_purpose := 'Preliminary screening before an initial consultation'; v_days := 30;
    v_allowed := array['IDENTITY','CONTACT','MOBILE','SCREENING','CORPORATE','LEGAL','MEDIA','WEB','PROFESSIONAL','SOCIAL'];
  elsif p_stage = 'FULL' then
    v_code := 'KYC_ONBOARDING'; v_purpose := 'KYC onboarding and ongoing due diligence'; v_days := 365;
    v_allowed := array['IDENTITY','DOCUMENTS','ADDRESS','CONTACT','MOBILE','BANKING','CREDIT','EMPLOYMENT','SCREENING','CORPORATE','LEGAL','MEDIA','WEB','PROFESSIONAL','SOCIAL','RISK'];
  else
    raise exception 'unknown consent stage';
  end if;
  select coalesce(array_agg(a order by ord), '{}') into v_sources
  from unnest(v_allowed) with ordinality as t(a, ord)
  where a = any (select upper(s) from unnest(coalesce(p_sources, '{}')) s);
  if coalesce(array_length(v_sources, 1), 0) = 0 then raise exception 'tick at least one category'; end if;

  -- Only the whitelisted, non-identifier keys are kept, each capped in length.
  v_details := jsonb_strip_nulls(jsonb_build_object(
    'employer', left(nullif(btrim(coalesce(p_details->>'employer', '')), ''), 120),
    'occupation', left(nullif(btrim(coalesce(p_details->>'occupation', '')), ''), 80),
    'city', left(nullif(btrim(coalesce(p_details->>'city', '')), ''), 80),
    'dob', case when coalesce(p_details->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then p_details->>'dob' else null end,
    'profiles', left(nullif(btrim(coalesce(p_details->>'profiles', '')), ''), 600)
  ));

  select id into v_token from portal_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_ref := 'PORTAL-' || case when p_stage = 'PRELIMINARY' then 'A' else 'B' end || '-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  update consents set status = 'EXPIRED' where client_id = v_client and purpose_code = v_code and status = 'GRANTED';

  insert into consents (client_id, status, purpose, purpose_code, granted_at, expires_at, sources_authorized, consent_reference, stage, captured_via, acceptance, legal_basis)
  values (v_client, 'GRANTED', v_purpose, v_code, now(), now() + make_interval(days => v_days), v_sources, v_ref, p_stage, 'CLIENT_PORTAL',
          jsonb_build_object('signedName', v_name, 'termsVersion', coalesce(p_terms_version, 'unknown'), 'acceptedAt', now(), 'userAgent', left(coalesce(p_user_agent, ''), 300), 'tokenId', v_token, 'requestedSources', coalesce(p_sources, '{}'), 'details', v_details),
          case when p_stage = 'PRELIMINARY' then 'DPDP Act 2023 s.6 consent (limited purpose); PMLA s.12 screening' else 'DPDP Act 2023 s.6 consent; PMLA s.12 KYC' end)
  returning id into v_id;

  update clients set consent_status = 'GRANTED',
    city = coalesce(city, v_details->>'city'),
    occupation = coalesce(occupation, v_details->>'occupation')
  where id = v_client;

  insert into portal_submissions (client_id, token_id, kind, payload, status, reviewed_at)
  values (v_client, v_token, 'CONSENT', jsonb_build_object('stage', p_stage, 'consentId', v_id, 'reference', v_ref, 'sources', v_sources, 'signedName', v_name, 'termsVersion', p_terms_version, 'details', v_details), 'ACCEPTED', now());

  insert into intelligence_events (client_id, event_type, title, detail, source_key, new_value)
  values (v_client, 'CONSENT', 'Client accepted ' || case when p_stage = 'PRELIMINARY' then 'Part A preliminary screening consent' else 'Part B full verification consent' end || ' via portal',
          'Reference ' || v_ref || '. Sources: ' || array_to_string(v_sources, ', ') || '. Valid ' || v_days || ' days.' || case when v_details = '{}'::jsonb then '' else ' Matching details supplied: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_details) k) || '.' end, 'CLIENT_PORTAL', v_ref);

  insert into audit_logs (actor_id, actor_role, action, client_id, entity_table, entity_id, details, user_agent)
  values (null, null, 'consent.portal_accept', v_client, 'consents', v_id::text,
          jsonb_build_object('stage', p_stage, 'purposeCode', v_code, 'sources', v_sources, 'reference', v_ref, 'termsVersion', p_terms_version, 'detailKeys', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(v_details) k)), left(coalesce(p_user_agent, ''), 300));
  return v_id;
end $$;

grant execute on function portal_consent(text, text, text[], text, text, text, jsonb) to anon, authenticated;
