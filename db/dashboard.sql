CREATE TABLE IF NOT EXISTS nh_documents(workspace text NOT NULL CHECK(workspace IN ('live','sample')),kind text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace,kind,id));
CREATE TABLE IF NOT EXISTS nh_money(workspace text NOT NULL CHECK(workspace IN ('live','sample')),id text NOT NULL,day date NOT NULL,service text NOT NULL,business text NOT NULL,kind text NOT NULL CHECK(kind IN ('income','expense','refund','expense_refund')),amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),category text NOT NULL,partner text NOT NULL,reference text NOT NULL,note text NOT NULL,voided integer NOT NULL DEFAULT 0 CHECK(voided IN(0,1)),PRIMARY KEY(workspace,id),UNIQUE(workspace,reference));
CREATE TABLE IF NOT EXISTS nh_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace text NOT NULL CHECK(workspace IN ('live','sample')),at timestamptz NOT NULL DEFAULT now(),email text NOT NULL,action text NOT NULL,target text NOT NULL);
CREATE INDEX IF NOT EXISTS nh_documents_updated ON nh_documents(workspace,kind,updated DESC);
CREATE INDEX IF NOT EXISTS nh_money_day ON nh_money(workspace,day DESC);
CREATE INDEX IF NOT EXISTS nh_audit_recent ON nh_audit(workspace,id DESC);
ALTER TABLE nh_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nh_money ENABLE ROW LEVEL SECURITY;
ALTER TABLE nh_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nh_documents,nh_money,nh_audit FROM PUBLIC,anon,authenticated;
DO $$DECLARE t text;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'mkt_%' OR tablename LIKE 'nh_%') LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO nh_web',t);
  EXECUTE format('CREATE POLICY nh_server_only ON public.%I FOR ALL TO nh_web USING(true) WITH CHECK(true)',t);
 END LOOP;
END$$;
GRANT USAGE ON SCHEMA public TO nh_web;
GRANT USAGE,SELECT ON SEQUENCE nh_audit_id_seq TO nh_web;
