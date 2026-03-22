CREATE TABLE task_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_task_activity_task_id ON task_activity(task_id);
CREATE INDEX idx_task_activity_user_id ON task_activity(user_id);
CREATE INDEX idx_task_activity_created_at ON task_activity(project_id);