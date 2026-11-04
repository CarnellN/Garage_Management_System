-- ============================================================================
-- Garage Management System — MySQL 8.0.16+ Schema
-- Database: garage_management_db
-- Engine:   InnoDB (all tables)
-- Charset:  utf8mb4
--
-- Normalised to 3NF. Prices are snapshotted into job_part and invoice_line
-- at time of use so historical invoices are immutable when catalogue prices
-- change. Derived columns (amount_paid, balance_due, payment_status) are
-- computed at query time, not stored.
--
-- Run once against a fresh database:
--   mysql -u garage_user -p garage_management_db < schema.sql
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- 1. CUSTOMER
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer (
    customer_id   INT           NOT NULL AUTO_INCREMENT,
    name          VARCHAR(120)  NOT NULL,
    phone         VARCHAR(30)       NULL DEFAULT NULL,
    email         VARCHAR(160)      NULL DEFAULT NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id),
    CONSTRAINT chk_customer_name_not_blank CHECK (name <> '' AND name REGEXP '\\S')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. USER (login accounts)
--    - CUSTOMER roles MUST have a linked customer_id.
--    - Staff roles (RECEPTIONIST, MECHANIC, ADMIN) MUST have customer_id NULL.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `user` (
    user_id        INT           NOT NULL AUTO_INCREMENT,
    customer_id    INT               NULL DEFAULT NULL,
    name           VARCHAR(120)  NOT NULL,
    email          VARCHAR(160)  NOT NULL,
    password_hash  VARCHAR(255)  NOT NULL,
    role           ENUM('CUSTOMER','RECEPTIONIST','MECHANIC','ADMIN') NOT NULL,
    active         TINYINT(1)    NOT NULL DEFAULT 1,
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_user_email (email),
    UNIQUE KEY uq_user_customer_id (customer_id),
    CONSTRAINT fk_user_customer
        FOREIGN KEY (customer_id) REFERENCES customer (customer_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_user_name_not_blank   CHECK (name <> '' AND name REGEXP '\\S'),
    CONSTRAINT chk_user_email_not_blank  CHECK (email <> '')
    -- NOTE: The business rule "CUSTOMER role requires customer_id; staff roles
    -- require NULL customer_id" is enforced at the application layer because
    -- MySQL 8.0 does not allow CHECK constraints on columns involved in a
    -- foreign key with referential actions (ON UPDATE/DELETE).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. VEHICLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicle (
    vehicle_id      INT          NOT NULL AUTO_INCREMENT,
    customer_id     INT          NOT NULL,
    registration_no VARCHAR(30)  NOT NULL,
    make            VARCHAR(60)      NULL DEFAULT NULL,
    model           VARCHAR(60)      NULL DEFAULT NULL,
    year            SMALLINT         NULL DEFAULT NULL,
    mileage         INT UNSIGNED     NULL DEFAULT NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (vehicle_id),
    UNIQUE KEY uq_vehicle_registration_no (registration_no),
    CONSTRAINT fk_vehicle_customer
        FOREIGN KEY (customer_id) REFERENCES customer (customer_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_vehicle_reg_not_blank CHECK (registration_no <> ''),
    CONSTRAINT chk_vehicle_year          CHECK (year IS NULL OR (year >= 1886 AND year <= 2100)),
    CONSTRAINT chk_vehicle_mileage       CHECK (mileage IS NULL OR mileage >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. BAY (service bays for scheduling)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bay (
    bay_id    INT          NOT NULL AUTO_INCREMENT,
    name      VARCHAR(60)  NOT NULL,
    enabled   TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (bay_id),
    CONSTRAINT chk_bay_name_not_blank CHECK (name <> '' AND name REGEXP '\\S')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 5. BOOKING
--    Half-open interval [scheduled_at, ends_at).
--    Overlap prevention for bay and vehicle enforced via application-level
--    locking within a serializable transaction (MySQL lacks exclusion
--    constraints). See the server README for details.
-- ============================================================================
CREATE TABLE IF NOT EXISTS booking (
    booking_id    INT       NOT NULL AUTO_INCREMENT,
    vehicle_id    INT       NOT NULL,
    bay_id        INT       NOT NULL,
    scheduled_at  DATETIME  NOT NULL,
    ends_at       DATETIME  NOT NULL,
    status        ENUM('PENDING','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'PENDING',
    version       INT       NOT NULL DEFAULT 1,
    created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (booking_id),
    INDEX idx_booking_vehicle_id (vehicle_id),
    INDEX idx_booking_bay_id (bay_id),
    INDEX idx_booking_scheduled_at (scheduled_at),
    INDEX idx_booking_status (status),
    CONSTRAINT fk_booking_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicle (vehicle_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_booking_bay
        FOREIGN KEY (bay_id) REFERENCES bay (bay_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_booking_interval CHECK (ends_at > scheduled_at),
    CONSTRAINT chk_booking_version  CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 6. JOB_CARD
--    - booking_id is nullable (walk-ins have no booking).
--    - booking_id is unique when not null (one job per booking).
--    - Enforce one active (non-terminal) job per vehicle at application level.
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_card (
    job_card_id   INT       NOT NULL AUTO_INCREMENT,
    vehicle_id    INT       NOT NULL,
    booking_id    INT           NULL DEFAULT NULL,
    mechanic_id   INT       NOT NULL,
    opened_at     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('OPEN','IN_PROGRESS','AWAITING_PARTS','COMPLETED','CLOSED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    version       INT       NOT NULL DEFAULT 1,
    created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (job_card_id),
    UNIQUE KEY uq_job_card_booking_id (booking_id),
    INDEX idx_job_card_vehicle_id (vehicle_id),
    INDEX idx_job_card_mechanic_id (mechanic_id),
    INDEX idx_job_card_status (status),
    CONSTRAINT fk_job_card_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicle (vehicle_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_job_card_booking
        FOREIGN KEY (booking_id) REFERENCES booking (booking_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_job_card_mechanic
        FOREIGN KEY (mechanic_id) REFERENCES `user` (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_job_card_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 7. SERVICE_TASK (reusable task templates / service catalogue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_task (
    service_task_id  INT           NOT NULL AUTO_INCREMENT,
    name             VARCHAR(120)  NOT NULL,
    standard_hours   DECIMAL(6,2)      NULL DEFAULT NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (service_task_id),
    CONSTRAINT chk_service_task_name_not_blank CHECK (name <> '' AND name REGEXP '\\S'),
    CONSTRAINT chk_service_task_hours          CHECK (standard_hours IS NULL OR standard_hours >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 8. TASK (performed tasks on a specific job card)
-- ============================================================================
CREATE TABLE IF NOT EXISTS task (
    task_id         INT           NOT NULL AUTO_INCREMENT,
    job_card_id     INT           NOT NULL,
    name            VARCHAR(120)  NOT NULL,
    standard_hours  DECIMAL(6,2)      NULL DEFAULT NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id),
    INDEX idx_task_job_card_id (job_card_id),
    CONSTRAINT fk_task_job_card
        FOREIGN KEY (job_card_id) REFERENCES job_card (job_card_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_task_name_not_blank CHECK (name <> '' AND name REGEXP '\\S'),
    CONSTRAINT chk_task_hours          CHECK (standard_hours IS NULL OR standard_hours >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 9. PART (parts catalogue with current unit price)
-- ============================================================================
CREATE TABLE IF NOT EXISTS part (
    part_id     INT            NOT NULL AUTO_INCREMENT,
    name        VARCHAR(120)   NOT NULL,
    unit_price  DECIMAL(10,2)      NULL DEFAULT NULL,
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (part_id),
    CONSTRAINT chk_part_name_not_blank CHECK (name <> '' AND name REGEXP '\\S'),
    CONSTRAINT chk_part_unit_price     CHECK (unit_price IS NULL OR unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 10. JOB_PART (junction: parts consumed on a job card)
--     unit_price_snapshot captured on first use so invoices remain immutable
--     when the catalogue price changes. Composite PK (job_card_id, part_id).
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_part (
    job_card_id          INT           NOT NULL,
    part_id              INT           NOT NULL,
    quantity             INT           NOT NULL,
    unit_price_snapshot  DECIMAL(10,2) NOT NULL,
    created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (job_card_id, part_id),
    INDEX idx_job_part_part_id (part_id),
    CONSTRAINT fk_job_part_job_card
        FOREIGN KEY (job_card_id) REFERENCES job_card (job_card_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_job_part_part
        FOREIGN KEY (part_id) REFERENCES part (part_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_job_part_quantity           CHECK (quantity >= 1),
    CONSTRAINT chk_job_part_unit_price_snapshot CHECK (unit_price_snapshot >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 11. INVOICE
--     One invoice per job card. total_amount is server-computed from lines.
--     amount_paid, balance_due and payment_status are derived at query time.
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice (
    invoice_id    INT            NOT NULL AUTO_INCREMENT,
    job_card_id   INT            NOT NULL,
    total_amount  DECIMAL(12,2)  NOT NULL,
    currency      CHAR(3)        NOT NULL DEFAULT 'KES',
    issued_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (invoice_id),
    UNIQUE KEY uq_invoice_job_card_id (job_card_id),
    CONSTRAINT fk_invoice_job_card
        FOREIGN KEY (job_card_id) REFERENCES job_card (job_card_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_invoice_total_amount CHECK (total_amount >= 0),
    CONSTRAINT chk_invoice_currency     CHECK (currency = 'KES')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 12. INVOICE_LINE (immutable snapshot of each line item)
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice_line (
    invoice_line_id  INT            NOT NULL AUTO_INCREMENT,
    invoice_id       INT            NOT NULL,
    kind             ENUM('LABOR','PART') NOT NULL,
    description      VARCHAR(120)   NOT NULL,
    quantity         DECIMAL(10,2)  NOT NULL,
    unit_price       DECIMAL(10,2)  NOT NULL,
    line_total       DECIMAL(12,2)  NOT NULL,
    PRIMARY KEY (invoice_line_id),
    INDEX idx_invoice_line_invoice_id (invoice_id),
    CONSTRAINT fk_invoice_line_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoice (invoice_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_invoice_line_desc_not_blank CHECK (description <> '' AND description REGEXP '\\S'),
    CONSTRAINT chk_invoice_line_quantity       CHECK (quantity >= 0),
    CONSTRAINT chk_invoice_line_unit_price     CHECK (unit_price >= 0),
    CONSTRAINT chk_invoice_line_total          CHECK (line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 13. PAYMENT
--     Non-cash payments must have a unique, non-null transaction_reference.
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment (
    payment_id             INT            NOT NULL AUTO_INCREMENT,
    invoice_id             INT            NOT NULL,
    amount                 DECIMAL(12,2)  NOT NULL,
    paid_at                DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    method                 ENUM('CASH','CARD','MOBILE_MONEY','BANK_TRANSFER') NOT NULL,
    transaction_reference  VARCHAR(120)       NULL DEFAULT NULL,
    created_at             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_id),
    INDEX idx_payment_invoice_id (invoice_id),
    UNIQUE KEY uq_payment_txn_ref (transaction_reference),
    CONSTRAINT fk_payment_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoice (invoice_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payment_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_payment_txn_ref CHECK (
        (method = 'CASH' OR transaction_reference IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 14. PAYMENT_INTENT (durable record of initiated payments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_intent (
    payment_intent_id  CHAR(36)       NOT NULL,
    invoice_id         INT            NOT NULL,
    amount             DECIMAL(12,2)  NOT NULL,
    method             ENUM('CASH','CARD','MOBILE_MONEY','BANK_TRANSFER') NOT NULL,
    status             ENUM('PENDING','SUCCEEDED','FAILED','EXPIRED') NOT NULL DEFAULT 'PENDING',
    checkout_url       VARCHAR(2048)      NULL DEFAULT NULL,
    expires_at         DATETIME       NOT NULL,
    payment_id         INT                NULL DEFAULT NULL,
    provider_id        VARCHAR(255)       NULL DEFAULT NULL,
    created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (payment_intent_id),
    INDEX idx_payment_intent_invoice_id (invoice_id),
    INDEX idx_payment_intent_status (status),
    CONSTRAINT fk_payment_intent_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoice (invoice_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_payment_intent_payment
        FOREIGN KEY (payment_id) REFERENCES payment (payment_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payment_intent_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 15. AUDIT_EVENT (append-only audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_event (
    audit_id       INT          NOT NULL AUTO_INCREMENT,
    actor_user_id  INT              NULL DEFAULT NULL,
    action         VARCHAR(100) NOT NULL,
    resource_type  VARCHAR(60)  NOT NULL,
    resource_id    VARCHAR(80)      NULL DEFAULT NULL,
    occurred_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_id     VARCHAR(100) NOT NULL,
    outcome        ENUM('SUCCESS','DENIED','FAILURE') NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audit_id),
    INDEX idx_audit_event_actor (actor_user_id),
    INDEX idx_audit_event_resource (resource_type, resource_id),
    INDEX idx_audit_event_occurred_at (occurred_at),
    CONSTRAINT fk_audit_event_actor
        FOREIGN KEY (actor_user_id) REFERENCES `user` (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_audit_action_not_blank        CHECK (action <> ''),
    CONSTRAINT chk_audit_resource_type_not_blank CHECK (resource_type <> ''),
    CONSTRAINT chk_audit_request_id_not_blank    CHECK (request_id <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 16. IDEMPOTENCY_KEY (prevents duplicate mutations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS idempotency_key (
    idempotency_key_id  INT            NOT NULL AUTO_INCREMENT,
    user_id             INT            NOT NULL,
    http_method         VARCHAR(10)    NOT NULL,
    path                VARCHAR(255)   NOT NULL,
    `key`               VARCHAR(128)   NOT NULL,
    request_fingerprint VARCHAR(255)       NULL DEFAULT NULL,
    response_status     SMALLINT           NULL DEFAULT NULL,
    response_body       JSON               NULL DEFAULT NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME       NOT NULL,
    PRIMARY KEY (idempotency_key_id),
    UNIQUE KEY uq_idempotency (user_id, http_method, path, `key`),
    INDEX idx_idempotency_expires (expires_at),
    CONSTRAINT fk_idempotency_user
        FOREIGN KEY (user_id) REFERENCES `user` (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_idempotency_key_length CHECK (CHAR_LENGTH(`key`) >= 16)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
