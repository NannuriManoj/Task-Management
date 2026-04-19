DROP TABLE IF EXISTS task_activity;

CREATE TABLE task_activity (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        VARCHAR     UNIQUE,
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id       UUID        REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_name    VARCHAR     NOT NULL,
  action        VARCHAR     NOT NULL,
  resource_type VARCHAR     NOT NULL,
  resource_id   UUID        NOT NULL,
  meta          JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_activity_project_id ON task_activity(project_id);
CREATE INDEX idx_task_activity_task_id ON task_activity(task_id);
CREATE INDEX idx_task_activity_actor_id ON task_activity(actor_id);
CREATE INDEX idx_task_activity_occurred_at ON task_activity(occurred_at DESC);
CREATE INDEX idx_task_activity_project_time ON task_activity(project_id, occurred_at DESC);