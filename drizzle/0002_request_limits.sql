-- Reviewed additive migration: a new operational table only. Existing tables,
-- rows and identities are untouched; portable backups exclude this table.
CREATE TABLE `request_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "request_limits_check_1" CHECK(count >= 0)
);
