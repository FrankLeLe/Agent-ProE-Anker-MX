-- Initial project schema. Apply explicitly to an approved PostgreSQL database.
-- Reapplying to existing tables fails; this file does not migrate or delete data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS mixture_x;

CREATE TABLE mixture_x.context_bundles (
    owner_id text NOT NULL,
    id text NOT NULL,
    context_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (owner_id, id),
    UNIQUE (owner_id, id, context_id),
    CHECK ((jsonb_typeof(payload) = 'object'
        AND payload->>'contract' = 'context-bundle.v1'
        AND payload->>'ownerId' = owner_id
        AND payload->>'id' = id
        AND payload->>'contextId' = context_id) IS TRUE)
);

CREATE TABLE mixture_x.artifact_versions (
    owner_id text NOT NULL,
    id text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    previous_version integer,
    context_id text NOT NULL,
    skill_id text NOT NULL CHECK (skill_id IN ('report-outline', 'requirements-checklist')),
    context_bundle_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (owner_id, id, version),
    UNIQUE (owner_id, id, version, context_id, skill_id),
    FOREIGN KEY (owner_id, context_bundle_id, context_id)
        REFERENCES mixture_x.context_bundles (owner_id, id, context_id),
    FOREIGN KEY (owner_id, id, previous_version, context_id, skill_id)
        REFERENCES mixture_x.artifact_versions (owner_id, id, version, context_id, skill_id),
    CHECK (((previous_version IS NULL AND version = 1)
        OR (previous_version > 0 AND version = previous_version + 1)) IS TRUE),
    CHECK ((jsonb_typeof(payload) = 'object'
        AND payload->>'contract' = 'prepared-artifact.v1'
        AND payload->>'ownerId' = owner_id
        AND payload->>'id' = id
        AND (payload->>'version')::integer = version
        AND payload ? 'previousVersion'
        AND (payload->>'previousVersion')::integer IS NOT DISTINCT FROM previous_version
        AND payload->>'contextId' = context_id
        AND payload->>'skillId' = skill_id
        AND payload->>'contextBundleId' = context_bundle_id) IS TRUE)
);

CREATE TABLE mixture_x.tool_runs (
    owner_id text NOT NULL,
    operation_id text NOT NULL,
    plan_id text NOT NULL,
    plan_hash text NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
    state text NOT NULL CHECK (state IN ('executing', 'completed', 'failed', 'result_unknown', 'cancelled')),
    payload jsonb NOT NULL,
    PRIMARY KEY (owner_id, operation_id),
    UNIQUE (owner_id, plan_hash),
    CHECK ((jsonb_typeof(payload) = 'object'
        AND payload->>'ownerId' = owner_id
        AND payload->>'operationId' = operation_id
        AND payload->>'planId' = plan_id
        AND payload->>'planHash' = plan_hash
        AND payload->>'state' = state
        AND payload ?& ARRAY['fileHash', 'storageKey', 'byteLength', 'verifiedAt', 'errorCode']) IS TRUE),
    CHECK (((payload->'fileHash' = 'null'::jsonb
             AND payload->'storageKey' = 'null'::jsonb
             AND payload->'byteLength' = 'null'::jsonb)
        OR (jsonb_typeof(payload->'fileHash') = 'string'
             AND payload->>'fileHash' ~ '^[a-f0-9]{64}$'
             AND jsonb_typeof(payload->'storageKey') = 'string'
             AND length(payload->>'storageKey') > 0
             AND jsonb_typeof(payload->'byteLength') = 'number'
             AND (payload->>'byteLength')::bigint > 0)) IS TRUE),
    CHECK (((state = 'completed'
             AND payload->>'fileHash' IS NOT NULL
             AND jsonb_typeof(payload->'verifiedAt') = 'string'
             AND length(payload->>'verifiedAt') > 0
             AND payload->'errorCode' = 'null'::jsonb)
        OR (state <> 'completed' AND payload->'verifiedAt' = 'null'::jsonb)) IS TRUE),
    CHECK ((state <> 'executing' OR payload->'errorCode' = 'null'::jsonb) IS TRUE)
);
COMMIT;
