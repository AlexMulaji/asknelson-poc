--
-- PostgreSQL database dump
--
-- NOT HAND-MAINTAINED. This is pg_dump output, kept as a readable snapshot of
-- the shape server/db.js produces. It is a record, never the source of truth:
-- the schema is built by the migrations in server/migrations/, applied on
-- startup, and editing this file changes nothing.
--
-- This snapshot was taken BEFORE migrations 004-006 and so does not yet show:
--
--   004_admin_rbac        admin_users, admin_sessions, admin_recovery_codes —
--                         named admin accounts with roles and TOTP, replacing
--                         the single shared ADMIN_PASSWORD
--   005_org_analytics     organisation_id on analytics_members, _devices,
--                         _sessions and _events, so reporting can group by
--                         employer without decrypting anything
--   006_member_usernames  auth_users.username backfilled and made NOT NULL,
--                         with a case-insensitive unique index
--
-- Refresh it after a deploy that applies new migrations:
--
--   pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" > docs/schema.sql
--

\restrict 582Jivlk2PFdPrRVDfDHIpfnirWxKUCeE6t1tbvAqYc9kdp3QTuBilKVL6gZWxP

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _analytics_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._analytics_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_daily_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_daily_counts (
    day date NOT NULL,
    event_name text NOT NULL,
    dims jsonb DEFAULT '{}'::jsonb NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: analytics_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_devices (
    id uuid NOT NULL,
    member_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_at timestamp with time zone,
    platform text,
    language text,
    timezone text,
    screen_w integer,
    screen_h integer,
    display_mode text,
    is_whatsapp boolean DEFAULT false NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    event_count integer DEFAULT 0 NOT NULL,
    user_agent_enc bytea,
    first_referrer_enc bytea,
    first_landing_path_enc bytea,
    first_utm_enc bytea
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id bigint NOT NULL,
    event_uid uuid NOT NULL,
    session_id uuid NOT NULL,
    device_id uuid NOT NULL,
    member_id uuid,
    name text NOT NULL,
    category text,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    client_seq integer,
    path_enc bytea,
    props_enc bytea NOT NULL
);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_events_id_seq OWNED BY public.analytics_events.id;


--
-- Name: analytics_link_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_link_tokens (
    token_hash text NOT NULL,
    member_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    first_used_at timestamp with time zone,
    last_used_at timestamp with time zone,
    use_count integer DEFAULT 0 NOT NULL,
    label_enc bytea
);


--
-- Name: analytics_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_members (
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    external_ref_hash text NOT NULL,
    external_ref_enc bytea,
    label_enc bytea
);


--
-- Name: analytics_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_sessions (
    id uuid NOT NULL,
    device_id uuid NOT NULL,
    member_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    source text,
    display_mode text,
    is_whatsapp boolean DEFAULT false NOT NULL,
    event_count integer DEFAULT 0 NOT NULL,
    entry_path_enc bytea,
    referrer_enc bytea,
    utm_enc bytea,
    user_agent_enc bytea
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    target_type text,
    target_id text,
    ip_hash text,
    details_enc bytea,
    CONSTRAINT audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'admin'::text, 'system'::text, 'anonymous'::text])))
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auth_otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_otp_codes (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    purpose text DEFAULT 'verify'::text NOT NULL,
    channel text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    destination_masked text
);


--
-- Name: auth_password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_password_resets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    channel text NOT NULL,
    destination_masked text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT auth_password_resets_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])))
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    persistent boolean DEFAULT true NOT NULL,
    user_agent_enc bytea
);


--
-- Name: auth_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_users (
    id uuid NOT NULL,
    is_anonymous boolean NOT NULL,
    username text,
    password_hash text NOT NULL,
    email_hash text,
    phone_hash text,
    id_number_hash text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    member_id uuid,
    email_enc bytea,
    phone_enc bytea,
    first_name_enc bytea,
    last_name_enc bytea,
    employee_no_enc bytea,
    organisation_id uuid,
    password_changed_at timestamp with time zone,
    CONSTRAINT auth_users_anon_unlinked_chk CHECK (((NOT is_anonymous) OR ((member_id IS NULL) AND (first_name_enc IS NULL) AND (last_name_enc IS NULL) AND (id_number_hash IS NULL)))),
    CONSTRAINT auth_users_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text])))
);


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisations (
    id uuid NOT NULL,
    name text NOT NULL,
    name_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_app_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_app_state (
    user_id uuid NOT NULL,
    last_route_enc bytea,
    preferences_enc bytea,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_assessment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_assessment_results (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    assessment_key text NOT NULL,
    result_enc bytea NOT NULL,
    taken_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    purpose text NOT NULL,
    notice_version text NOT NULL,
    granted boolean NOT NULL,
    source text DEFAULT 'registration'::text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_content_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_content_activity (
    user_id uuid NOT NULL,
    content_key text NOT NULL,
    content_enc bytea NOT NULL,
    open_count integer DEFAULT 1 NOT NULL,
    first_opened_at timestamp with time zone DEFAULT now() NOT NULL,
    last_opened_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_journey_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_journey_progress (
    user_id uuid NOT NULL,
    journey_key text NOT NULL,
    state_enc bytea NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    days_completed smallint DEFAULT 0 NOT NULL,
    total_days smallint,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT user_journey_progress_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text])))
);


--
-- Name: user_meditation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_meditation_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    planned_sec integer NOT NULL,
    elapsed_sec integer NOT NULL,
    sound text,
    completed boolean NOT NULL,
    ended_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_meditation_sessions_elapsed_sec_check CHECK ((elapsed_sec >= 0)),
    CONSTRAINT user_meditation_sessions_planned_sec_check CHECK ((planned_sec > 0))
);


--
-- Name: analytics_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN id SET DEFAULT nextval('public.analytics_events_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: _analytics_migrations _analytics_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._analytics_migrations
    ADD CONSTRAINT _analytics_migrations_pkey PRIMARY KEY (name);


--
-- Name: analytics_daily_counts analytics_daily_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_daily_counts
    ADD CONSTRAINT analytics_daily_counts_pkey PRIMARY KEY (day, event_name, dims);


--
-- Name: analytics_devices analytics_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_devices
    ADD CONSTRAINT analytics_devices_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_event_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_event_uid_key UNIQUE (event_uid);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_link_tokens analytics_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_link_tokens
    ADD CONSTRAINT analytics_link_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: analytics_members analytics_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_members
    ADD CONSTRAINT analytics_members_pkey PRIMARY KEY (id);


--
-- Name: analytics_sessions analytics_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_sessions
    ADD CONSTRAINT analytics_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_otp_codes auth_otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_otp_codes
    ADD CONSTRAINT auth_otp_codes_pkey PRIMARY KEY (id);


--
-- Name: auth_password_resets auth_password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_pkey PRIMARY KEY (id);


--
-- Name: auth_password_resets auth_password_resets_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: auth_users auth_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_pkey PRIMARY KEY (id);


--
-- Name: auth_users auth_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_username_key UNIQUE (username);


--
-- Name: organisations organisations_name_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_name_key_key UNIQUE (name_key);


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);


--
-- Name: user_app_state user_app_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_app_state
    ADD CONSTRAINT user_app_state_pkey PRIMARY KEY (user_id);


--
-- Name: user_assessment_results user_assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assessment_results
    ADD CONSTRAINT user_assessment_results_pkey PRIMARY KEY (id);


--
-- Name: user_assessment_results user_assessment_results_user_id_assessment_key_taken_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assessment_results
    ADD CONSTRAINT user_assessment_results_user_id_assessment_key_taken_at_key UNIQUE (user_id, assessment_key, taken_at);


--
-- Name: user_consents user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_pkey PRIMARY KEY (id);


--
-- Name: user_content_activity user_content_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_content_activity
    ADD CONSTRAINT user_content_activity_pkey PRIMARY KEY (user_id, content_key);


--
-- Name: user_journey_progress user_journey_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_journey_progress
    ADD CONSTRAINT user_journey_progress_pkey PRIMARY KEY (user_id, journey_key);


--
-- Name: user_meditation_sessions user_meditation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meditation_sessions
    ADD CONSTRAINT user_meditation_sessions_pkey PRIMARY KEY (id);


--
-- Name: analytics_devices_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_devices_last_seen_idx ON public.analytics_devices USING btree (last_seen_at DESC);


--
-- Name: analytics_devices_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_devices_member_idx ON public.analytics_devices USING btree (member_id);


--
-- Name: analytics_events_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_device_idx ON public.analytics_events USING btree (device_id, occurred_at DESC);


--
-- Name: analytics_events_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_member_idx ON public.analytics_events USING btree (member_id, occurred_at DESC);


--
-- Name: analytics_events_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_idx ON public.analytics_events USING btree (name, occurred_at DESC);


--
-- Name: analytics_events_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_occurred_idx ON public.analytics_events USING btree (occurred_at DESC);


--
-- Name: analytics_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_session_idx ON public.analytics_events USING btree (session_id, client_seq);


--
-- Name: analytics_link_tokens_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_link_tokens_member_idx ON public.analytics_link_tokens USING btree (member_id);


--
-- Name: analytics_members_ref_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_members_ref_hash_idx ON public.analytics_members USING btree (external_ref_hash);


--
-- Name: analytics_sessions_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_sessions_device_idx ON public.analytics_sessions USING btree (device_id, started_at DESC);


--
-- Name: analytics_sessions_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_sessions_member_idx ON public.analytics_sessions USING btree (member_id, started_at DESC);


--
-- Name: analytics_sessions_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_sessions_started_idx ON public.analytics_sessions USING btree (started_at DESC);


--
-- Name: audit_log_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_action_idx ON public.audit_log USING btree (action, occurred_at DESC);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_id, occurred_at DESC);


--
-- Name: audit_log_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_occurred_idx ON public.audit_log USING btree (occurred_at DESC);


--
-- Name: auth_otp_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_otp_user_idx ON public.auth_otp_codes USING btree (user_id, created_at DESC);


--
-- Name: auth_password_resets_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_password_resets_user_idx ON public.auth_password_resets USING btree (user_id, created_at DESC);


--
-- Name: auth_sessions_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_expiry_idx ON public.auth_sessions USING btree (expires_at);


--
-- Name: auth_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_user_idx ON public.auth_sessions USING btree (user_id);


--
-- Name: auth_users_email_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_users_email_hash_idx ON public.auth_users USING btree (email_hash) WHERE (email_hash IS NOT NULL);


--
-- Name: auth_users_id_number_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_users_id_number_hash_idx ON public.auth_users USING btree (id_number_hash) WHERE (id_number_hash IS NOT NULL);


--
-- Name: auth_users_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_users_member_idx ON public.auth_users USING btree (member_id);


--
-- Name: auth_users_organisation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_users_organisation_idx ON public.auth_users USING btree (organisation_id);


--
-- Name: auth_users_phone_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_users_phone_hash_idx ON public.auth_users USING btree (phone_hash) WHERE (phone_hash IS NOT NULL);


--
-- Name: user_consents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_consents_user_idx ON public.user_consents USING btree (user_id, purpose, recorded_at DESC);


--
-- Name: user_content_activity_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_content_activity_recent_idx ON public.user_content_activity USING btree (user_id, last_opened_at DESC);


--
-- Name: user_journey_progress_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_journey_progress_active_idx ON public.user_journey_progress USING btree (user_id) WHERE is_active;


--
-- Name: user_meditation_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_meditation_sessions_user_idx ON public.user_meditation_sessions USING btree (user_id, ended_at DESC);


--
-- Name: analytics_devices analytics_devices_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_devices
    ADD CONSTRAINT analytics_devices_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.analytics_members(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.analytics_devices(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.analytics_members(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.analytics_sessions(id) ON DELETE CASCADE;


--
-- Name: analytics_link_tokens analytics_link_tokens_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_link_tokens
    ADD CONSTRAINT analytics_link_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.analytics_members(id) ON DELETE CASCADE;


--
-- Name: analytics_sessions analytics_sessions_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_sessions
    ADD CONSTRAINT analytics_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.analytics_devices(id) ON DELETE CASCADE;


--
-- Name: analytics_sessions analytics_sessions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_sessions
    ADD CONSTRAINT analytics_sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.analytics_members(id) ON DELETE SET NULL;


--
-- Name: auth_otp_codes auth_otp_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_otp_codes
    ADD CONSTRAINT auth_otp_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: auth_password_resets auth_password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: auth_users auth_users_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.analytics_members(id) ON DELETE SET NULL;


--
-- Name: auth_users auth_users_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE SET NULL;


--
-- Name: user_app_state user_app_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_app_state
    ADD CONSTRAINT user_app_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: user_assessment_results user_assessment_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_assessment_results
    ADD CONSTRAINT user_assessment_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: user_consents user_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: user_content_activity user_content_activity_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_content_activity
    ADD CONSTRAINT user_content_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: user_journey_progress user_journey_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_journey_progress
    ADD CONSTRAINT user_journey_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- Name: user_meditation_sessions user_meditation_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meditation_sessions
    ADD CONSTRAINT user_meditation_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 582Jivlk2PFdPrRVDfDHIpfnirWxKUCeE6t1tbvAqYc9kdp3QTuBilKVL6gZWxP

