-- 0003: two-stage consent captured in the client portal
-- Part A (PRELIMINARY_SCREENING, 30 days, public-record + ownership checks only)
-- Part B (KYC_ONBOARDING, 365 days, full verification).
-- The person accepts on their own device through the portal token the RM delivered to them;
-- the acceptance (typed name, ticked sources, terms version, user agent, time) is the evidence.

alter table consents
  add column if not exists stage text,                       -- PRELIMINARY | FULL | null (staff-recorded)
  add column if not exists captured_via text not null default 'STAFF',  -- STAFF | CLIENT_PORTAL
  add column if not exists acceptance jsonb not null default '{}';

-- Expose purpose code, stage and reference to the portal so it can show which stage is in force.
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
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'purpose', k.purpose, 'purposeCode', k.purpose_code, 'stage', k.stage, 'status', k.status, 'grantedAt', k.granted_at, 'expiresAt', k.expires_at, 'sources', k.sources_authorized, 'reference', k.consent_reference, 'capturedVia', k.captured_via) order by k.created_at desc), '[]') from consents k where k.client_id = c.id)
  ) into v_out from clients c where c.id = v_client;
  return v_out;
end $$;

-- Record a stage of consent from the portal. Sources are clamped server-side to what the stage permits,
-- so a tampered client cannot grant Part B categories under Part A.
create or replace function portal_consent(p_token text, p_stage text, p_sources text[], p_full_name text, p_user_agent text, p_terms_version text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_token uuid; v_id uuid; v_code text; v_purpose text; v_days integer;
  v_allowed text[]; v_sources text[]; v_ref text; v_name text;
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
  select id into v_token from portal_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_ref := 'PORTAL-' || case when p_stage = 'PRELIMINARY' then 'A' else 'B' end || '-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- A new acceptance of the same stage supersedes the previous one.
  update consents set status = 'EXPIRED' where client_id = v_client and purpose_code = v_code and status = 'GRANTED';

  insert into consents (client_id, status, purpose, purpose_code, granted_at, expires_at, sources_authorized, consent_reference, stage, captured_via, acceptance, legal_basis)
  values (v_client, 'GRANTED', v_purpose, v_code, now(), now() + make_interval(days => v_days), v_sources, v_ref, p_stage, 'CLIENT_PORTAL',
          jsonb_build_object('signedName', v_name, 'termsVersion', coalesce(p_terms_version, 'unknown'), 'acceptedAt', now(), 'userAgent', left(coalesce(p_user_agent, ''), 300), 'tokenId', v_token, 'requestedSources', coalesce(p_sources, '{}')),
          case when p_stage = 'PRELIMINARY' then 'DPDP Act 2023 s.6 consent (limited purpose); PMLA s.12 screening' else 'DPDP Act 2023 s.6 consent; PMLA s.12 KYC' end)
  returning id into v_id;

  update clients set consent_status = 'GRANTED' where id = v_client;

  insert into portal_submissions (client_id, token_id, kind, payload, status, reviewed_at)
  values (v_client, v_token, 'CONSENT', jsonb_build_object('stage', p_stage, 'consentId', v_id, 'reference', v_ref, 'sources', v_sources, 'signedName', v_name, 'termsVersion', p_terms_version), 'ACCEPTED', now());

  insert into intelligence_events (client_id, event_type, title, detail, source_key, new_value)
  values (v_client, 'CONSENT', 'Client accepted ' || case when p_stage = 'PRELIMINARY' then 'Part A preliminary screening consent' else 'Part B full verification consent' end || ' via portal',
          'Reference ' || v_ref || '. Sources: ' || array_to_string(v_sources, ', ') || '. Valid ' || v_days || ' days.', 'CLIENT_PORTAL', v_ref);

  insert into audit_logs (actor_id, actor_role, action, client_id, entity_table, entity_id, details, user_agent)
  values (null, null, 'consent.portal_accept', v_client, 'consents', v_id::text,
          jsonb_build_object('stage', p_stage, 'purposeCode', v_code, 'sources', v_sources, 'reference', v_ref, 'termsVersion', p_terms_version), left(coalesce(p_user_agent, ''), 300));
  return v_id;
end $$;

grant execute on function portal_consent(text, text, text[], text, text, text) to anon, authenticated;
