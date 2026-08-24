-- Business rule 1: a pensioner may have only one active case at a time.
-- The app already checks this before insert (assertOneActiveCase), but that
-- check-then-insert has a race window under concurrent requests. This
-- partial unique index closes it at the database level: at most one row
-- per clientId can have active = true.
CREATE UNIQUE INDEX "Case_clientId_active_unique" ON "Case" ("clientId") WHERE "active" = true;
