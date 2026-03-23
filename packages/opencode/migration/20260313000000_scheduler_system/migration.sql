-- Scheduler Job Table
CREATE TABLE IF NOT EXISTS `scheduler_job` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `schedule_type` text NOT NULL,
  `schedule_expr` text NOT NULL,
  `payload_type` text NOT NULL,
  `payload` text NOT NULL,
  `options` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `last_run_at` integer,
  `next_run_at` integer,
  `last_status` text,
  `last_error` text,
  `consecutive_errors` integer DEFAULT 0 NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);

-- Scheduler Execution Table
CREATE TABLE IF NOT EXISTS `scheduler_execution` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `started_at` integer,
  `finished_at` integer,
  `duration_ms` integer,
  `output` text,
  `error` text,
  `heartbeat_at` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `scheduler_job`(`id`) ON DELETE CASCADE
);

-- Scheduler Log Table
CREATE TABLE IF NOT EXISTS `scheduler_log` (
  `id` text PRIMARY KEY NOT NULL,
  `execution_id` text NOT NULL,
  `level` text NOT NULL,
  `message` text NOT NULL,
  `timestamp` integer NOT NULL,
  FOREIGN KEY (`execution_id`) REFERENCES `scheduler_execution`(`id`) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS `scheduler_job_enabled_idx` ON `scheduler_job` (`enabled`);
CREATE INDEX IF NOT EXISTS `scheduler_job_next_run_idx` ON `scheduler_job` (`next_run_at`);
CREATE INDEX IF NOT EXISTS `scheduler_execution_job_idx` ON `scheduler_execution` (`job_id`);
CREATE INDEX IF NOT EXISTS `scheduler_execution_status_idx` ON `scheduler_execution` (`status`);
CREATE INDEX IF NOT EXISTS `scheduler_log_execution_idx` ON `scheduler_log` (`execution_id`);
